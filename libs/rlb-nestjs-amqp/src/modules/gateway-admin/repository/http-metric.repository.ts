import { HttpMetric, TrackCallInput } from '../models';

/** Repository contract for HTTP call metric counters. Implemented by the consuming app. */
export abstract class HttpMetricRepository {
  /** Upserts the (method, route) counter, incrementing count/errors/duration. */
  abstract increment(input: TrackCallInput): Promise<void>;
  /** Counters (optionally filtered by route) with computed avg duration. */
  abstract list(route?: string): Promise<(HttpMetric & { avgDurationMs: number; })[]>;
}
