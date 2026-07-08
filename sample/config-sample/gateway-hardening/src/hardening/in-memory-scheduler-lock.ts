import { Injectable, Logger } from '@nestjs/common';
import { GatewaySchedulerLock } from '@open-rlb/nestjs-amqp';

/**
 * Reference {@link GatewaySchedulerLock} bound under the RLB_GW_SCHED_LOCK token. It gates the
 * gateway-admin scheduled jobs (hourly metric rollup, daily retention prune) so — in a cluster —
 * only ONE instance runs a given tick instead of every instance doing the same delete/aggregate.
 *
 * ⚠️ This implementation is IN-PROCESS (a plain Map), so it only dedups within a single process.
 * It is here to show the WIRING and the lease/TTL semantics. For a real multi-instance deployment,
 * back it with a SHARED store so peers see each other's lease. Drop-in alternatives:
 *
 *   // Redis (ioredis) — SET NX PX is an atomic acquire with auto-expiry:
 *   async tryAcquire(name: string, ttlMs: number) {
 *     return (await this.redis.set(`gw-lock:${name}`, this.instanceId, 'PX', ttlMs, 'NX')) === 'OK';
 *   }
 *   async release(name: string) {
 *     // Only delete if we still own it (Lua compare-and-del), so we never drop a peer's lease.
 *     await this.redis.eval(RELEASE_LUA, 1, `gw-lock:${name}`, this.instanceId);
 *   }
 *
 *   // Mongo — a unique index on { name } + a TTL index on { expiresAt } makes acquire an upsert
 *   // that succeeds only when no live lease exists:
 *   async tryAcquire(name, ttlMs) {
 *     try { await this.locks.updateOne(
 *       { name, expiresAt: { $lte: new Date() } },
 *       { $set: { name, owner: this.instanceId, expiresAt: new Date(Date.now()+ttlMs) } },
 *       { upsert: true }); return true; }
 *     catch (e) { if (e.code === 11000) return false; throw e; } // duplicate key => held elsewhere
 *   }
 */
@Injectable()
export class InMemorySchedulerLock implements GatewaySchedulerLock {
  private readonly logger = new Logger(InMemorySchedulerLock.name);
  /** name → epoch ms the current lease expires. */
  private readonly leases = new Map<string, number>();

  async tryAcquire(name: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const held = this.leases.get(name);
    if (held != null && held > now) {
      this.logger.debug?.(`[sched-lock] '${name}' already held (in-process); skipping`);
      return false;
    }
    this.leases.set(name, now + ttlMs);
    this.logger.debug?.(`[sched-lock] acquired '${name}' for ${ttlMs}ms`);
    return true;
  }

  async release(name: string): Promise<void> {
    this.leases.delete(name);
    this.logger.debug?.(`[sched-lock] released '${name}'`);
  }
}
