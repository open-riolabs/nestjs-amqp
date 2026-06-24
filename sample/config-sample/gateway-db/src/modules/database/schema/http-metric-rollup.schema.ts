import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema } from 'mongoose';
import { DATA_CONNECTION_NAME, METRIC_ROLLUP_MODEL } from '../connections';

/**
 * A pre-aggregated, downsampled metrics bucket (one doc per
 * bucketStart+granularityMs+method+route). Unlike raw `http-metric-point` rows (which are pruned
 * for retention), rollups persist long-term so trend series survive raw-point expiry. Percentiles
 * are NOT rolled up; a rollup keeps counts, error count, duration sum/min/max and the status breakdown.
 */
const HttpMetricRollupSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  bucketStart: { type: Number, index: true },
  granularityMs: Number,
  method: String,
  route: String,
  name: String,
  count: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  totalDurationMs: { type: Number, default: 0 },
  minDurationMs: Number,
  maxDurationMs: Number,
  byStatus: Schema.Types.Mixed,
});

// Exported for tests.
export const httpMetricRollupSchema = HttpMetricRollupSchema;

// One rollup per (bucket, granularity, method, route) — the upsert key.
HttpMetricRollupSchema.index({ bucketStart: 1, granularityMs: 1, method: 1, route: 1 }, { unique: true });

export const httpMetricRollupModel = {
  provide: METRIC_ROLLUP_MODEL,
  useFactory: (connection: Connection) => connection.model('http-metric-rollup', HttpMetricRollupSchema, 'http-metric-rollup'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};
