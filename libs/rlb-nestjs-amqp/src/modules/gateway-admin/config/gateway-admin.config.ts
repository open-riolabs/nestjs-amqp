export interface GatewayAdminModuleOptions {
  /** Broker topic to bind handlers to (default GATEWAY_ADMIN_TOPIC = 'rlb-gateway-admin'). */
  topic?: string;
  /**
   * Route auto-discovery — CONSUMER side. The gateway receives microservice route manifests here.
   * Only the exchange/queue names are needed (no serviceName: the gateway publishes nothing and
   * keeps its own connection_name). These MUST match the publishers' broker.routeDiscovery values.
   * Defaults: exchange 'rlb-route-discovery', queue 'rlb-route-sync'.
   */
  routeDiscovery?: {
    exchange?: string;
    queue?: string;
  };
  /**
   * Retention window in DAYS for the route journal AND the raw metric points. Rows older than the
   * window are pruned daily by GatewayRetentionService. Default 90 (≈3 months); set 0 or negative
   * to disable pruning entirely.
   */
  retentionDays?: number;
  /**
   * Retention window in DAYS for the persisted metric ROLLUPS (the hourly downsampled aggregates
   * that survive raw-point retention). Default 365 (1 year). When > 0 the hourly rollup job runs and
   * old rollups are pruned at this window; set 0/negative to disable rollups entirely.
   */
  rollupRetentionDays?: number;
  /**
   * Hard cap on the number of raw points a single `series` / `summary` query may load into memory
   * before aggregating app-side (percentiles need the full set, so the window drives the row count).
   * Protects the consumer from an OOM on a wide `from/to` window. Default 500000; when the cap is hit
   * the newest N points are used and a warning is logged (results are then computed over a truncated
   * window). Set 0/negative to disable the cap (unbounded — not recommended in production).
   */
  metricsQueryMaxPoints?: number;
}
