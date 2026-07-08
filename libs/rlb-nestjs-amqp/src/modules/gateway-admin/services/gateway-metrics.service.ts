import { Injectable, Logger } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '../../broker';
import { GATEWAY_ADMIN_TOPIC, GATEWAY_METRICS_TOPIC, GW_ADMIN_ACTIONS } from '../const';
import { HttpMetric, HttpMetricPoint, HttpMetricRollup, MetricSeriesBucket, MetricSummary, TrackCallInput } from '../models';
import { HttpMetricRepository } from '../repository/http-metric.repository';
import { buildSeries, buildSummary, toPrometheus } from '../util/metrics';

@Injectable()
export class GatewayMetricsService {
  private readonly logger = new Logger(GatewayMetricsService.name);

  constructor(private readonly repo: HttpMetricRepository) { }

  /** Fire-and-forget per-call event: the gateway publishes one of these per request. Updates the
   *  rolling counters AND appends a raw data point so the backend can build time-series.
   *  Also bound to the OPTIONAL dedicated metrics topic: declaring `rlb-gateway-metrics`
   *  (+ its own queue) in the broker config and pointing `gateway.metrics.topic` at it moves
   *  this high-volume traffic off the admin queue, so a slow metrics DB can no longer starve
   *  `gw-health` / `gw-reload` / admin RPCs. Never throws (fail-soft by design). */
  @BrokerAction(GATEWAY_METRICS_TOPIC, GW_ADMIN_ACTIONS.metricsTrack, 'event', { optional: true })
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
        code: input.code,
      });
    } catch (error) {
      this.logger.error(error);
    }
  }

  /** Aggregated counters for the frontend (count / errors / avg duration per route). */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsGet, 'rpc')
  async get(@BrokerParam('body', 'route') route?: string): Promise<(HttpMetric & { avgDurationMs: number; errorRate: number; })[]> {
    return this.repo.list(route);
  }

  /** Time-series: enriched bucketed aggregates (count/errors/avg|min|max + p50/p95/p99 + byStatus),
   *  computed app-side from the raw points so latency percentiles are available. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsSeries, 'rpc')
  async series(
    @BrokerParam('body', 'bucketMs') bucketMs?: number | string,
    @BrokerParam('body', 'from') from?: number | string,
    @BrokerParam('body', 'to') to?: number | string,
    @BrokerParam('body', 'method') method?: string,
    @BrokerParam('body', 'route') route?: string,
    @BrokerParam('body', 'name') name?: string,
  ): Promise<MetricSeriesBucket[]> {
    const f = from != null ? Number(from) : undefined;
    const t = to != null ? Number(to) : undefined;
    const points = await this.repo.points({ method, route, name, from: f, to: t });
    return buildSeries(points, { bucketMs: Number(bucketMs) || 60_000, from: f, to: t, method, route, name });
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

  /** Dashboard overview from raw points: totals, error rate, p50/p95/p99, status breakdown, and the
   *  top-N routes by traffic / errors / p95 latency. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsSummary, 'rpc')
  async summary(
    @BrokerParam('body', 'from') from?: number | string,
    @BrokerParam('body', 'to') to?: number | string,
    @BrokerParam('body', 'method') method?: string,
    @BrokerParam('body', 'route') route?: string,
    @BrokerParam('body', 'name') name?: string,
    @BrokerParam('body', 'topN') topN?: number | string,
  ): Promise<MetricSummary> {
    const points = await this.repo.points({
      method, route, name,
      from: from != null ? Number(from) : undefined,
      to: to != null ? Number(to) : undefined,
    });
    return buildSummary(points, Number(topN) || 10);
  }

  /** Prometheus text exposition of the rolling counters. The route should set
   *  `headers: { Content-Type: 'text/plain' }` so the gateway returns it raw (not JSON). */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsPrometheus, 'rpc')
  async prometheus(@BrokerParam('body', 'route') route?: string): Promise<string> {
    return toPrometheus(await this.repo.list(route));
  }

  /** Long-term downsampled rollups (hourly buckets that survive raw-point retention). */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsRollups, 'rpc')
  async rollups(
    @BrokerParam('body', 'bucketMs') bucketMs?: number | string,
    @BrokerParam('body', 'from') from?: number | string,
    @BrokerParam('body', 'to') to?: number | string,
    @BrokerParam('body', 'method') method?: string,
    @BrokerParam('body', 'route') route?: string,
    @BrokerParam('body', 'name') name?: string,
  ): Promise<HttpMetricRollup[]> {
    return this.repo.rollupSeries({
      bucketMs: Number(bucketMs) || 3_600_000,
      from: from != null ? Number(from) : undefined,
      to: to != null ? Number(to) : undefined,
      method, route, name,
    });
  }
}
