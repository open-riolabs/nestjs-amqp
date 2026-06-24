import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { GatewayAdminModuleOptions } from '../config/gateway-admin.config';
import { RLB_GW_ADMIN_OPTIONS } from '../const';
import { HttpMetricRepository } from '../repository/http-metric.repository';
import { aggregateRollups } from '../util/metrics';

const HOUR_MS = 3_600_000;
const DEFAULT_ROLLUP_RETENTION_DAYS = 365;

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

  /** Aggregate the just-completed hour's raw points into hourly rollups. Never throws. */
  private async rollup(): Promise<void> {
    const hourStart = Math.floor(Date.now() / HOUR_MS) * HOUR_MS - HOUR_MS;
    try {
      const points = await this.metrics.points({ from: hourStart, to: hourStart + HOUR_MS - 1 });
      if (!points.length) return;
      const rollups = aggregateRollups(points, HOUR_MS);
      await this.metrics.recordRollups(rollups);
      this.logger.log(`[rollup] ${points.length} point(s) → ${rollups.length} hourly rollup(s) for ${new Date(hourStart).toISOString()}`);
    } catch (e) {
      this.logger.warn(`[rollup] failed: ${(e as Error)?.message}`);
    }
  }
}
