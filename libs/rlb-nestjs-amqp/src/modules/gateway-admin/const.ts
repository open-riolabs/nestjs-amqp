/** Broker topic the gateway-admin handlers are bound to. The consumer declares a
 *  matching topic and points `gateway.loadConfig.paths` to {topic: this, action: 'gw-path-export'}. */
export const GATEWAY_ADMIN_TOPIC = 'rlb-gateway-admin';

export const RLB_GW_ADMIN_OPTIONS = 'RLB_GW_ADMIN_OPTIONS';

export const GW_ADMIN_ACTIONS = {
  pathCreate: 'gw-path-create',
  pathUpdate: 'gw-path-update',
  pathDelete: 'gw-path-delete',
  pathGet: 'gw-path-get',
  pathList: 'gw-path-list',
  /** Free-text search over stored routes. Input `{ q, limit? }` → StoredHttpPath[]. */
  pathSearch: 'gw-path-search',
  pathExport: 'gw-path-export',
  /** Read the route-change journal (auto-discovery + user CRUD), newest first. */
  routeLogList: 'gw-route-log-list',
  /** Filtered + paginated journal query (actor/service/event/routeKey/time). */
  routeLogSearch: 'gw-route-log-search',
  // Auth-providers are keyed by `name` (no id). PUT upserts by name; there is no POST.
  authUpdate: 'gw-auth-update',
  authDelete: 'gw-auth-delete',
  authGet: 'gw-auth-get',
  authList: 'gw-auth-list',
  /** Free-text search over stored auth-providers. Input `{ q, limit? }` → StoredAuthProvider[]. */
  authSearch: 'gw-auth-search',
  authExport: 'gw-auth-export',
  metricsTrack: 'gw-metrics-track',
  metricsGet: 'gw-metrics-get',
  metricsSeries: 'gw-metrics-series',
  metricsPoints: 'gw-metrics-points',
  /** Dashboard overview: totals, percentiles, status breakdown, top-N (computed from raw points). */
  metricsSummary: 'gw-metrics-summary',
  /** Prometheus text exposition of the rolling counters. */
  metricsPrometheus: 'gw-metrics-prometheus',
  /** Long-term downsampled rollups (survive raw-point retention). */
  metricsRollups: 'gw-metrics-rollups',
  /** Liveness probe: returns a tiny { status:'ok' } so /health is a 200, not a data dump. */
  health: 'gw-health',
} as const;
