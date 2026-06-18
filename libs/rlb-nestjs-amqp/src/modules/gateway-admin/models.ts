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
}

/** Persistent journal entry written by the route sync — one row per change. */
export interface RouteSyncLogEntry<Id = string> {
  _id?: Id;
  ts: number;
  service: string;
  level: 'info' | 'warn' | 'error';
  /** 'added' | 'updated' | 'removed' | 'collision' | 'invalid' | 'reload' */
  event: string;
  routeKey?: string;
  method?: string;
  path?: string;
  topic?: string;
  action?: string;
  owner?: string;
  conflictWith?: string;
  message?: string;
}
