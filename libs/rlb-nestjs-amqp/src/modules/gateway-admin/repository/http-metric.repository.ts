import { HttpMetric, HttpMetricPoint, MetricQuery, MetricSeriesBucket, MetricSeriesQuery, TrackCallInput } from '../models';

/**
 * Repository contract for HTTP call metrics. Implemented by the consuming app. Two layers:
 *  - cheap rolling COUNTERS per (method, route) — `increment` / `list`;
 *  - raw DATA POINTS for TIME-SERIES — `record` / `points` / `series`.
 * A backend may implement only the layer it needs; the contract carries enough information
 * (timestamp + method/route/name/topic/action/mode/status/duration) to build arbitrary series.
 */
export abstract class HttpMetricRepository {
  // --- rolling counters (per method+route) ---------------------------------
  /** Upserts the (method, route) counter, incrementing count/errors/duration. */
  abstract increment(input: TrackCallInput): Promise<void>;
  /** Counters (optionally filtered by route) with computed avg duration. */
  abstract list(route?: string): Promise<(HttpMetric & { avgDurationMs: number; })[]>;

  // --- raw points / time-series --------------------------------------------
  /** Append a single raw data point (one per request) — enables time-series construction. */
  abstract record(point: HttpMetricPoint): Promise<void>;
  /** Raw data points matching the query (newest first) — for inspection / export / custom rollups. */
  abstract points(query: MetricQuery): Promise<HttpMetricPoint[]>;
  /** Bucketed time-series (count / errors / avg|min|max duration per fixed-width window). */
  abstract series(query: MetricSeriesQuery): Promise<MetricSeriesBucket[]>;
}
