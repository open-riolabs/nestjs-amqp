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

  /** Aggregate the just-completed hour's raw points into hourly rollups. Never throws. */
  private async rollup(): Promise<void> {
    if (!(await this.acquire(GW_SCHED_LOCK_NAMES.rollup))) {
      this.logger.debug?.('[rollup] skipped this tick: lock held by another instance');
      return;
    }
    const hourStart = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
    try {
      const points = await this.metrics.points({ from: hourStart, to: hourStart + HOUR_MS - 1 });
      if (!points.length) return;
      const rollups = aggregateRollups(points, HOUR_MS);
      await this.metrics.recordRollups(rollups);
      this.logger.log(`[rollup] ${points.length} point(s) → ${rollups.length} hourly rollup(s) for ${new Date(hourStart).toISOString()}`);
    } catch (e) {
      this.logger.warn(`[rollup] failed: ${(e as Error)?.message}`);
    } finally {
      if (this.lock?.release) {
        try { await this.lock.release(GW_SCHED_LOCK_NAMES.rollup); } catch { /* lease will expire on its own */ }
      }
    }
  }
}
