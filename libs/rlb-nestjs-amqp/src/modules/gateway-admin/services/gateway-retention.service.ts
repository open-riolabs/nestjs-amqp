import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { GatewayAdminModuleOptions } from '../config/gateway-admin.config';
import { RLB_GW_ADMIN_OPTIONS } from '../const';
import { HttpMetricRepository } from '../repository/http-metric.repository';
import { RouteSyncLogRepository } from '../repository/route-sync-log.repository';

const DAY_MS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 90; // ≈ 3 months
const DEFAULT_ROLLUP_RETENTION_DAYS = 365; // ≈ 1 year

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
  ) {
    this.windowMs = (options?.retentionDays ?? DEFAULT_RETENTION_DAYS) * DAY_MS;
    this.rollupWindowMs = (options?.rollupRetentionDays ?? DEFAULT_ROLLUP_RETENTION_DAYS) * DAY_MS;
  }

  onApplicationBootstrap(): void {
    if (this.windowMs <= 0 && this.rollupWindowMs <= 0) {
      this.logger.log('[retention] disabled');
      return;
    }
    void this.prune();
    this.timer = setInterval(() => void this.prune(), DAY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Prune journal entries + raw points (retentionDays) and rollups (rollupRetentionDays). Never throws. */
  private async prune(): Promise<void> {
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
    }
  }
}
