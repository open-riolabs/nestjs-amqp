import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { GatewayAdminModuleOptions } from '../config/gateway-admin.config';
import { RLB_GW_ADMIN_OPTIONS, RLB_GW_SCHED_LOCK } from '../const';
import { HttpMetricRepository } from '../repository/http-metric.repository';
import { GatewaySchedulerLock, GW_SCHED_LOCK_NAMES } from '../scheduler-lock';
import { aggregateRollups } from '../util/metrics';

const HOUR_MS = 3_600_000;
const DEFAULT_ROLLUP_RETENTION_DAYS = 365;
/** Lock lease for one rollup run; auto-expires if the holder dies mid-aggregation. */
const LOCK_TTL_MS = 5 * 60_000;
/**
 * How many recently-completed hours the boot catch-up rolls up. Covers instances that live < 1h
 * (autoscaled / frequently redeployed) which would otherwise never reach the hourly interval tick,
 * so raw points get pruned before any rollup is produced. Idempotent, so overlap between instances
 * is harmless.
 */
const BOOT_CATCHUP_HOURS = 3;

/**
 * Downsamples raw metric points into persisted hourly rollups so long-term trends survive raw-point
 * retention. Runs every hour, aggregating the just-completed hour. Enabled when
 * `GatewayAdminModuleOptions.rollupRetentionDays > 0` (default 365).
 */
@Injectable()
export class GatewayMetricsRollupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GatewayMetricsRollupService.name);
  private readonly enabled: boolean;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly metrics: HttpMetricRepository,
    @Optional() @Inject(RLB_GW_ADMIN_OPTIONS) options?: GatewayAdminModuleOptions,
    @Optional() @Inject(RLB_GW_SCHED_LOCK) private readonly lock?: GatewaySchedulerLock,
  ) {
    this.enabled = (options?.rollupRetentionDays ?? DEFAULT_ROLLUP_RETENTION_DAYS) > 0;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('[rollup] disabled (rollupRetentionDays <= 0)');
      return;
    }
    // Boot catch-up: roll up the last few COMPLETED hours immediately. Without this the first tick
    // only fires after HOUR_MS, so an instance that lives < 1h never produces any rollup and its raw
    // points are pruned un-aggregated. Idempotent (upsert-by-bucket), so overlapping a peer is safe.
    void this.runCatchup(BOOT_CATCHUP_HOURS);
    this.timer = setInterval(() => void this.rollup(), HOUR_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Best-effort lock acquisition: when a lock is configured, only its holder runs this tick. A lock
   * backend error is treated as "proceed" so an outage degrades to duplicated (idempotent, upsert-by-
   * bucket) work rather than silently dropping the hour's rollup.
   */
  private async acquire(name: string): Promise<boolean> {
    if (!this.lock) return true;
    try {
      return await this.lock.tryAcquire(name, LOCK_TTL_MS);
    } catch (e) {
      this.logger.warn(`[rollup] scheduler lock '${name}' errored (${(e as Error)?.message}); running anyway`);
      return true;
    }
  }

  /** Scheduled tick: aggregate the just-completed hour under the distributed lock. Never throws. */
  private async rollup(): Promise<void> {
    if (!(await this.acquire(GW_SCHED_LOCK_NAMES.rollup))) {
      this.logger.debug?.('[rollup] skipped this tick: lock held by another instance');
      return;
    }
    try {
      await this.rollupHour(this.previousHourStart());
    } finally {
      await this.releaseLock();
    }
  }

  /** Boot-time catch-up over the last `hours` completed hours, under a single lock lease. Never throws. */
  private async runCatchup(hours: number): Promise<void> {
    if (!(await this.acquire(GW_SCHED_LOCK_NAMES.rollup))) {
      this.logger.debug?.('[rollup] boot catch-up skipped: lock held by another instance');
      return;
    }
    try {
      const base = this.previousHourStart();
      for (let i = 0; i < hours; i++) {
        await this.rollupHour(base - i * HOUR_MS);
      }
    } finally {
      await this.releaseLock();
    }
  }

  /** Start (epoch ms) of the most recently COMPLETED hour. */
  private previousHourStart(): number {
    return Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
  }

  /** Aggregate one hour's raw points into hourly rollups (idempotent upsert-by-bucket). Never throws. */
  private async rollupHour(hourStart: number): Promise<void> {
    try {
      const points = await this.metrics.points({ from: hourStart, to: hourStart + HOUR_MS - 1 });
      if (!points.length) return;
      const rollups = aggregateRollups(points, HOUR_MS);
      await this.metrics.recordRollups(rollups);
      this.logger.log(`[rollup] ${points.length} point(s) → ${rollups.length} hourly rollup(s) for ${new Date(hourStart).toISOString()}`);
    } catch (e) {
      this.logger.warn(`[rollup] failed for ${new Date(hourStart).toISOString()}: ${(e as Error)?.message}`);
    }
  }

  /** Best-effort early lock release; a failure is fine because the lease auto-expires. */
  private async releaseLock(): Promise<void> {
    if (this.lock?.release) {
      try { await this.lock.release(GW_SCHED_LOCK_NAMES.rollup); } catch { /* lease will expire on its own */ }
    }
  }
}
