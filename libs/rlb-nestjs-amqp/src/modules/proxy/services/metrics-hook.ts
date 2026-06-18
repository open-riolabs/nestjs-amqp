/** DI token for an in-proxy metrics hook (see {@link GatewayMetricsHook}). */
export const RLB_GTW_METRICS_HOOK = 'RLB_GTW_METRICS_HOOK';

/** One served HTTP call, as the gateway sees it — everything the proxy knows at response time. */
export interface GatewayMetricPoint {
  /** Epoch ms when the response was flushed. */
  ts: number;
  method: string;
  /** Route template that was matched (e.g. /users/:id). */
  route: string;
  name?: string;
  topic?: string;
  action?: string;
  mode?: string;
  status?: number;
  durationMs?: number;
}

/**
 * Hook point invoked by the gateway ONCE per served request, after the response is flushed.
 * Register an implementation under {@link RLB_GTW_METRICS_HOOK} (in `ProxyModule.forRootAsync`'s
 * `providers`) to receive every call — e.g. to write it straight to a time-series database
 * (InfluxDB, Prometheus pushgateway, …). It runs independently of the broker-based
 * `gateway.metrics` sink (both can be active). It must NOT throw and should be cheap/async.
 */
export interface GatewayMetricsHook {
  track(point: GatewayMetricPoint): void | Promise<void>;
}
