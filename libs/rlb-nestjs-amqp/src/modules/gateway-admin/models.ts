export interface HttpMetric<Id = string> {
  _id?: Id;
  method: string;
  /** Route template that was matched (e.g. /users/:id) or the raw path. */
  route: string;
  name?: string;
  topic?: string;
  action?: string;
  count: number;
  errorCount: number;
  lastStatus?: number;
  lastCalledAt?: number;
  totalDurationMs: number;
  /** Error name/code of the most recent error response (status >= 400), from the unified envelope. */
  lastErrorCode?: string;
}

export interface TrackCallInput {
  method: string;
  route: string;
  name?: string;
  topic?: string;
  action?: string;
  mode?: string;
  status?: number;
  durationMs?: number;
  /** Error name/code (from the unified error envelope) when status >= 400. */
  code?: string;
  /** When the request finished (epoch ms). Set by the gateway; used for time-series. */
  ts?: number;
}

/**
 * A single tracked HTTP call — the atomic data point for time-series. Carries as much as the
 * gateway knows about the call so a backend can build arbitrary series (by route/method/time).
 */
export interface HttpMetricPoint<Id = string> {
  _id?: Id;
  /** Epoch ms when the request finished. */
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
  /** Error name/code (from the unified error envelope) when status >= 400. */
  code?: string;
}

/** Filter for raw points / series queries. All fields optional → "everything". */
export interface MetricQuery {
  method?: string;
  route?: string;
  name?: string;
  /** Inclusive time bounds (epoch ms). */
  from?: number;
  to?: number;
  /** Cap on the number of raw points returned (points() only). */
  limit?: number;
}

/** Time-series request: bucketed aggregates over `bucketMs`-wide windows. */
export interface MetricSeriesQuery extends MetricQuery {
  /** Bucket width in ms (e.g. 60000 = 1 minute). Required. */
  bucketMs: number;
}

/** One time bucket of aggregated metrics. */
export interface MetricSeriesBucket {
  /** Epoch ms, aligned down to a multiple of `bucketMs`. */
  bucketStart: number;
  count: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  /** Duration percentiles (ms) within the bucket. */
  p50?: number;
  p95?: number;
  p99?: number;
  /** Response counts per HTTP status class within the bucket. */
  byStatus?: MetricStatusClasses;
}

/** HTTP status classes. */
export type MetricStatusClass = '2xx' | '3xx' | '4xx' | '5xx';
export type MetricStatusClasses = Record<MetricStatusClass, number>;

/** One route's row in a metrics summary / top-N list. */
export interface MetricTopEntry {
  method: string;
  route: string;
  name?: string;
  count: number;
  errorCount: number;
  errorRate: number;
  avgDurationMs: number;
  p95?: number;
}

/** Dashboard overview over a time range: totals, percentiles, status breakdown, top-N routes. */
export interface MetricSummary {
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  avgDurationMs: number;
  p50?: number;
  p95?: number;
  p99?: number;
  byStatus: MetricStatusClasses;
  topByTraffic: MetricTopEntry[];
  topByErrors: MetricTopEntry[];
  topByLatency: MetricTopEntry[];
}

/** A persisted, pre-aggregated metrics bucket (downsampled from raw points) so long-term trends
 *  survive raw-point retention. Percentiles are NOT rolled up (they need the raw distribution) —
 *  a rollup keeps counts, error count, duration sum/min/max, and the status breakdown, per route. */
export interface HttpMetricRollup<Id = string> {
  _id?: Id;
  /** Epoch ms, aligned down to a multiple of `granularityMs`. */
  bucketStart: number;
  /** Bucket width this rollup was aggregated at (e.g. 3600000 = 1h). */
  granularityMs: number;
  method?: string;
  route?: string;
  name?: string;
  count: number;
  errorCount: number;
  totalDurationMs: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  byStatus?: MetricStatusClasses;
}

/** One property that changed between two versions of a route. For an array field (e.g. `actions`)
 *  `added`/`removed` carry the set difference; for a scalar, `added=[newValue]` / `removed=[oldValue]`
 *  (either side empty when the value was absent before/after). Rendered as `field: [+a, -b]`. */
export interface RouteFieldChange {
  field: string;
  added: any[];
  removed: any[];
}

/** Filter for the route-journal query (all fields optional → everything). */
export interface RouteSyncLogQuery {
  actor?: string;
  service?: string;
  event?: string;
  routeKey?: string;
  /** Inclusive epoch-ms bounds on `ts`. */
  from?: number;
  to?: number;
}

/** Persistent journal entry written by the route sync AND by user route CRUD — one row per change. */
export interface RouteSyncLogEntry<Id = string> {
  _id?: Id;
  ts: number;
  service: string;
  level: 'info' | 'warn' | 'error';
  /** Who triggered it: 'system' (route auto-discovery) or the acting user's id (manual CRUD). */
  actor?: string;
  /** 'added' | 'updated' | 'removed' | 'skipped' | 'collision' | 'invalid' | 'reload'
   *  (user CRUD: 'created' | 'updated' | 'deleted') */
  event: string;
  routeKey?: string;
  method?: string;
  path?: string;
  topic?: string;
  action?: string;
  owner?: string;
  conflictWith?: string;
  /** Per-field diff of what changed (present on updates). */
  changes?: RouteFieldChange[];
  message?: string;
}
