import { Injectable, Logger } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '../../broker';
import { GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS } from '../const';
import { HttpMetric, HttpMetricPoint, MetricSeriesBucket, TrackCallInput } from '../models';
import { HttpMetricRepository } from '../repository/http-metric.repository';

@Injectable()
export class GatewayMetricsService {
  private readonly logger = new Logger(GatewayMetricsService.name);

  constructor(private readonly repo: HttpMetricRepository) { }

  /** Fire-and-forget per-call event: the gateway publishes one of these per request. Updates the
   *  rolling counters AND appends a raw data point so the backend can build time-series. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsTrack, 'event')
  async track(@BrokerParam('body-full') input: TrackCallInput): Promise<void> {
    try {
      if (!input?.method || !input?.route) return;
      await this.repo.increment(input);
      await this.repo.record({
        ts: input.ts ?? Date.now(),
        method: input.method,
        route: input.route,
        name: input.name,
        topic: input.topic,
        action: input.action,
        mode: input.mode,
        status: input.status,
        durationMs: input.durationMs,
      });
    } catch (error) {
      this.logger.error(error);
    }
  }

  /** Aggregated counters for the frontend (count / errors / avg duration per route). */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsGet, 'rpc')
  async get(@BrokerParam('body', 'route') route?: string): Promise<(HttpMetric & { avgDurationMs: number; })[]> {
    return this.repo.list(route);
  }

  /** Time-series: bucketed aggregates over `bucketMs`-wide windows, optionally filtered. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsSeries, 'rpc')
  async series(
    @BrokerParam('body', 'bucketMs') bucketMs?: number | string,
    @BrokerParam('body', 'from') from?: number | string,
    @BrokerParam('body', 'to') to?: number | string,
    @BrokerParam('body', 'method') method?: string,
    @BrokerParam('body', 'route') route?: string,
    @BrokerParam('body', 'name') name?: string,
  ): Promise<MetricSeriesBucket[]> {
    return this.repo.series({
      bucketMs: Number(bucketMs) || 60_000,
      from: from != null ? Number(from) : undefined,
      to: to != null ? Number(to) : undefined,
      method,
      route,
      name,
    });
  }

  /** Raw data points (newest first), optionally filtered/limited. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsPoints, 'rpc')
  async points(
    @BrokerParam('body', 'method') method?: string,
    @BrokerParam('body', 'route') route?: string,
    @BrokerParam('body', 'from') from?: number | string,
    @BrokerParam('body', 'to') to?: number | string,
    @BrokerParam('body', 'limit') limit?: number | string,
  ): Promise<HttpMetricPoint[]> {
    return this.repo.points({
      method,
      route,
      from: from != null ? Number(from) : undefined,
      to: to != null ? Number(to) : undefined,
      limit: limit != null ? Number(limit) : undefined,
    });
  }
}
