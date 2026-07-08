import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { GatewayAdminModuleOptions } from '../config/gateway-admin.config';
import { RLB_GW_ADMIN_OPTIONS, RLB_GW_SCHED_LOCK } from '../const';
import { HttpMetricRepository } from '../repository/http-metric.repository';
import { RouteSyncLogRepository } from '../repository/route-sync-log.repository';
import { GatewaySchedulerLock, GW_SCHED_LOCK_NAMES } from '../scheduler-lock';

const DAY_MS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 90; // ≈ 3 months
const DEFAULT_ROLLUP_RETENTION_DAYS = 365; // ≈ 1 year
/** Lock lease for a prune run; long enough for a big delete, auto-expires if the holder dies. */
const LOCK_TTL_MS = 10 * 60_000;
/** Max random start delay when NO lock is configured, to stagger simultaneous restarts. */
const BOOT_JITTER_MS = 30_000;

/**
 * Caps the growth of the two unbounded stores — the route journal and the raw metric points — by
 * pruning rows older than `GatewayAdminModuleOptions.retentionDays` (default 90). Runs once at
 * bootstrap and then daily; set retentionDays to 0/negative to disable.
 */
@Injectable()
export class GatewayRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GatewayRetentionService.name);
  private readonly windowMs: number;
  private readonly rollupWindowMs: number;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly logs: RouteSyncLogRepository,
    private readonly metrics: HttpMetricRepository,
    @Optional() @Inject(RLB_GW_ADMIN_OPTIONS) options?: GatewayAdminModuleOptions,
    @Optional() @Inject(RLB_GW_SCHED_LOCK) private readonly lock?: GatewaySchedulerLock,
  ) {
    this.windowMs = (options?.retentionDays ?? DEFAULT_RETENTION_DAYS) * DAY_MS;
    this.rollupWindowMs = (options?.rollupRetentionDays ?? DEFAULT_ROLLUP_RETENTION_DAYS) * DAY_MS;
  }

  onApplicationBootstrap(): void {
    if (this.windowMs <= 0 && this.rollupWindowMs <= 0) {
      this.logger.log('[retention] disabled');
      return;
    }
    // With no distributed lock, stagger the boot prune so a simultaneous cluster restart doesn't
    // fire every instance's big delete at once; the lock (when present) makes this unnecessary.
    const jitter = this.lock ? 0 : Math.floor(Math.random() * BOOT_JITTER_MS);
    setTimeout(() => void this.prune(), jitter).unref?.();
    this.timer = setInterval(() => void this.prune(), DAY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Best-effort lock acquisition: when a lock is configured, only the holder runs this tick. A lock
   * BACKEND error is treated as "proceed" (return true) so a lock outage degrades to duplicated work
   * rather than stopping pruning entirely (which would let the stores grow unbounded).
   */
  private async acquire(name: string): Promise<boolean> {
    if (!this.lock) return true;
    try {
      return await this.lock.tryAcquire(name, LOCK_TTL_MS);
    } catch (e) {
      this.logger.warn(`[retention] scheduler lock '${name}' errored (${(e as Error)?.message}); running anyway`);
      return true;
    }
  }

  /** Prune journal entries + raw points (retentionDays) and rollups (rollupRetentionDays). Never throws. */
  private async prune(): Promise<void> {
    if (!(await this.acquire(GW_SCHED_LOCK_NAMES.retention))) {
      this.logger.debug?.('[retention] skipped this tick: lock held by another instance');
      return;
    }
    const now = Date.now();
    try {
      let prunedLogs = 0, prunedPoints = 0, prunedRollups = 0;
      if (this.windowMs > 0) {
        const cutoff = now - this.windowMs;
        prunedLogs = await this.logs.prune(cutoff);
        prunedPoints = await this.metrics.prunePoints(cutoff);
      }
      if (this.rollupWindowMs > 0) prunedRollups = await this.metrics.pruneRollups(now - this.rollupWindowMs);
      this.logger.log(`[retention] pruned ${prunedLogs} journal + ${prunedPoints} point(s) + ${prunedRollups} rollup(s)`);
    } catch (e) {
      this.logger.warn(`[retention] prune failed: ${(e as Error)?.message}`);
    } finally {
      if (this.lock?.release) {
        try { await this.lock.release(GW_SCHED_LOCK_NAMES.retention); } catch { /* lease will expire on its own */ }
      }
    }
  }
}
