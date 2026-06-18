import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema } from 'mongoose';
import { DATA_CONNECTION_NAME, HTTP_METRIC_POINT_MODEL } from '../connections';

/**
 * One raw data point per served request — the atomic source for time-series. Unlike the rolling
 * `http-metric` counter (one doc per method+route), this collection appends a doc per call so
 * `points()` / `series()` can build arbitrary windowed aggregates.
 */
const HttpMetricPointSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  ts: { type: Number, index: true },
  method: String,
  route: String,
  name: String,
  topic: String,
  action: String,
  mode: String,
  status: Number,
  durationMs: Number,
});

// Exported for tests.
export const httpMetricPointSchema = HttpMetricPointSchema;

// Common series query shape: filter by route/method over a time window.
HttpMetricPointSchema.index({ route: 1, ts: 1 });
HttpMetricPointSchema.index({ method: 1, ts: 1 });

export const httpMetricPointModel = {
  provide: HTTP_METRIC_POINT_MODEL,
  useFactory: (connection: Connection) => connection.model('http-metric-point', HttpMetricPointSchema, 'http-metric-point'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};
