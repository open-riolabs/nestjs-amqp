import { HttpMetric, HttpMetricPoint, HttpMetricRollup, MetricQuery, MetricSeriesQuery, TrackCallInput } from '../models';

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
  /** Counters (optionally filtered by route) with computed avg duration + error rate. */
  abstract list(route?: string): Promise<(HttpMetric & { avgDurationMs: number; errorRate: number; })[]>;

  // --- raw points ----------------------------------------------------------
  /** Append a single raw data point (one per request). series/summary are computed from these. */
  abstract record(point: HttpMetricPoint): Promise<void>;
  /** Raw data points matching the query (newest first) — also the source for series + summary. */
  abstract points(query: MetricQuery): Promise<HttpMetricPoint[]>;

  // --- rollups (downsampled long-term aggregates) --------------------------
  /** Upsert pre-aggregated rollup buckets, keyed by (bucketStart, granularityMs, method, route). */
  abstract recordRollups(rollups: HttpMetricRollup[]): Promise<void>;
  /** Read rollup buckets matching the query (time range / method / route), oldest first. */
  abstract rollupSeries(query: MetricSeriesQuery): Promise<HttpMetricRollup[]>;
  /** Delete rollup buckets older than `olderThanTs` (epoch ms); returns the number removed. */
  abstract pruneRollups(olderThanTs: number): Promise<number>;

  // --- retention -----------------------------------------------------------
  /** Delete raw data points older than `olderThanTs` (epoch ms); returns the number removed. The
   *  rolling counters are bounded (one row per route) and are not pruned. */
  abstract prunePoints(olderThanTs: number): Promise<number>;
}
