import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AclModuleOptions } from '../config/acl.config';
import { RLB_ACL_CACHE_STORE, RLB_ACL_OPTIONS } from '../const';
import { AclCacheStore } from './cache-store';

interface RamEntry { v: boolean; exp: number; }

@Injectable()
export class AclCacheService {
  private readonly logger = new Logger(AclCacheService.name);
  private readonly ram = new Map<string, RamEntry>();
  private readonly ramTtlMs: number;
  private readonly l2TtlSec: number;
  /** Hard cap on L1 entries; <= 0 disables the cap. */
  private readonly maxRamEntries: number;
  /**
   * Monotonic invalidation counter. Bumped on every invalidation (local, L2 or broadcast-received).
   * A `checkAction` snapshots it BEFORE reading the DB and passes it back to `set()`; if the counter
   * has moved in between, the decision was computed from now-stale data and the write is dropped.
   * This closes the re-population race where a concurrent grant/revoke invalidated the cache but an
   * in-flight check then re-wrote the pre-mutation decision into L1/L2 (which would otherwise persist
   * for up to `l2TtlSec`). Coarse by design (any invalidation drops all in-flight writes) but a single
   * bounded integer — a rejected write just becomes a cache miss, never an incorrect grant/deny.
   */
  private gen = 0;

  /** Current invalidation generation; snapshot it before a DB resolution and pass to `set()`. */
  get generation(): number {
    return this.gen;
  }

  constructor(
    @Inject(RLB_ACL_OPTIONS) options: AclModuleOptions,
    @Optional() @Inject(RLB_ACL_CACHE_STORE) private readonly store?: AclCacheStore,
  ) {
    this.ramTtlMs = options.cache?.ramTtlMs ?? 30_000;
    this.l2TtlSec = options.cache?.l2TtlSec ?? 600;
    this.maxRamEntries = options.cache?.maxRamEntries ?? 50_000;
  }

  private key(userId: string, action: string): string {
    return `acl/${userId}/${action}`;
  }

  /**
   * Insert into L1 and enforce the size cap: a plain Map iterates in insertion order, so evicting
   * from the front drops the oldest entries first (approximate LRU without per-read bookkeeping).
   * Prevents an unbounded RAM footprint under high `(userId × scope × actionset)` cardinality.
   */
  private ramSet(key: string, entry: RamEntry): void {
    // Re-insert at the tail so a refreshed key is treated as most-recent by the eviction order.
    this.ram.delete(key);
    this.ram.set(key, entry);
    if (this.maxRamEntries > 0) {
      while (this.ram.size > this.maxRamEntries) {
        const oldest = this.ram.keys().next().value;
        if (oldest === undefined) break;
        this.ram.delete(oldest);
      }
    }
  }

  /** Cached decision (L1 → L2), or null on a miss (caller must read from the DB). */
  async get(userId: string, action: string): Promise<boolean | null> {
    const key = this.key(userId, action);
    const local = this.ram.get(key);
    if (local && local.exp > Date.now()) return local.v;
    if (local) this.ram.delete(key);
    if (this.store) {
      try {
        const cached = await this.store.get(key);
        if (cached === '1' || cached === '0') {
          const value = cached === '1';
          this.ramSet(key, { v: value, exp: Date.now() + this.ramTtlMs });
          return value;
        }
      } catch (error) {
        this.logger.warn(`ACL L2 cache read failed for ${key}: ${error?.message}`);
      }
    }
    return null;
  }

  async set(userId: string, action: string, value: boolean, seenGen?: number): Promise<void> {
    // Drop a decision computed from data that was invalidated while this check was in flight: the
    // caller snapshotted `generation` before its DB read, so a moved counter means the value is stale.
    if (seenGen !== undefined && seenGen !== this.gen) return;
    const key = this.key(userId, action);
    this.ramSet(key, { v: value, exp: Date.now() + this.ramTtlMs });
    if (this.store) {
      try {
        await this.store.set(key, value ? '1' : '0', this.l2TtlSec);
      } catch (error) {
        this.logger.warn(`ACL L2 cache write failed for ${key}: ${error?.message}`);
      }
    }
  }

  /** Drop cached decisions so the next check is forced to read from the database. */
  async invalidate(userId?: string): Promise<void> {
    this.invalidateLocalRam(userId);
    if (!this.store) return;
    const pattern = userId ? `acl/${userId}/*` : 'acl/*';
    try {
      const keys = await this.store.keys(pattern);
      if (keys.length) await this.store.del(keys);
    } catch (error) {
      this.logger.warn(`ACL L2 cache invalidation failed for ${pattern}: ${error?.message}`);
    }
  }

  /** Clears only the in-process RAM tier (used by the broadcast invalidation handler). */
  invalidateLocalRam(userId?: string): void {
    // Bump the generation so any check already in flight (which snapshotted the previous value)
    // will not re-populate a stale decision. This is the single choke point for every invalidation
    // path — `invalidate()` calls it, and the broadcast handler calls it directly.
    this.gen++;
    if (!userId) {
      this.ram.clear();
      return;
    }
    const prefix = `acl/${userId}/`;
    for (const key of this.ram.keys()) {
      if (key.startsWith(prefix)) this.ram.delete(key);
    }
  }
}
