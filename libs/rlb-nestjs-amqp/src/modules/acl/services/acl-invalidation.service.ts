import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AmqpConnection } from '../../../amqp-lib';
import { AclInvalidationOptions } from '../config/acl.config';
import { RLB_ACL_INVALIDATION } from '../const';
import { AclCacheService } from '../cache/acl-cache.service';
import { AclService } from './acl.service';

/** Wire message for a cross-instance ACL invalidation. */
interface AclInvalidationMessage {
  /** 'user' clears one user's decisions; 'all' clears every decision + the roles memo. */
  scope: 'user' | 'all';
  userId?: string;
}

/**
 * Propagates ACL cache invalidations across instances over AMQP. Each instance binds an ephemeral,
 * per-instance queue to the configured exchange (typically a fanout) and, on a message, flushes its
 * LOCAL L1 (RAM) cache — the L2 store is already shared/cleared by the mutating instance. Without
 * this, peers keep serving stale allow/deny decisions until their RAM entries expire (`ramTtlMs`).
 *
 * No-op (disabled) when `AclModuleOptions.invalidation` is not configured or no AmqpConnection is
 * available, so existing single-instance / RAM-only deployments are unaffected.
 */
@Injectable()
export class AclInvalidationService implements OnModuleInit {
  private readonly logger = new Logger(AclInvalidationService.name);
  private readonly exchange?: string;
  private readonly routingKey: string;
  private readonly enabled: boolean;

  constructor(
    private readonly cache: AclCacheService,
    private readonly acl: AclService,
    @Optional() private readonly amqp?: AmqpConnection,
    @Optional() @Inject(RLB_ACL_INVALIDATION) config?: AclInvalidationOptions,
  ) {
    this.exchange = config?.exchange;
    this.routingKey = config?.routingKey ?? 'acl-invalidate';
    this.enabled = !!(this.exchange && this.amqp);
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    // Per-instance, ephemeral, exclusive queue: every instance receives every invalidation and
    // flushes its own RAM. It must die with the instance (autoDelete) so retired instances leave
    // no dangling queue accumulating messages.
    const queue = `acl-invalidate-${process.pid}-${randomUUID().slice(0, 8)}`;
    try {
      await this.amqp!.createSubscriber<AclInvalidationMessage>(
        async (msg) => this.apply(msg),
        {
          queue,
          exchange: this.exchange!,
          routingKey: this.routingKey,
          createQueueIfNotExists: true,
          queueOptions: { durable: false, autoDelete: true, exclusive: true },
        },
        '',
        {},
      );
      this.logger.log(`[acl] cross-instance invalidation active on exchange '${this.exchange}' (queue '${queue}')`);
    } catch (error) {
      this.logger.error(`[acl] failed to bind invalidation queue on '${this.exchange}': ${(error as Error)?.message}. Ensure the exchange is declared in broker.exchanges. Falling back to RAM-local invalidation.`);
    }
  }

  /** Apply an invalidation received from a peer to this instance's local caches only (no re-publish). */
  private apply(msg?: AclInvalidationMessage): void {
    if (msg?.scope === 'all') {
      this.cache.invalidateLocalRam();
      this.acl.invalidateRolesCache();
    } else {
      this.cache.invalidateLocalRam(msg?.userId);
    }
  }

  /**
   * Broadcast an invalidation to peer instances. Called AFTER the local `cache.invalidate(...)`
   * (which also clears the shared L2). Never throws: a broadcast failure must not fail the ACL
   * mutation that triggered it.
   */
  async broadcast(scope: 'user' | 'all', userId?: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.amqp!.publish(this.exchange!, this.routingKey, { scope, userId } as AclInvalidationMessage);
    } catch (error) {
      this.logger.warn(`[acl] failed to broadcast invalidation (${scope}${userId ? `/${userId}` : ''}): ${(error as Error)?.message}`);
    }
  }
}
