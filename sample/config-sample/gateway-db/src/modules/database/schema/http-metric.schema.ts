import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema } from 'mongoose';
import { DATA_CONNECTION_NAME, HTTP_METRIC_MODEL } from '../connections';

const HttpMetricSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  method: String,
  route: String,
  name: String,
  topic: String,
  action: String,
  count: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  lastStatus: Number,
  lastCalledAt: Number,
  totalDurationMs: { type: Number, default: 0 },
  // Error name/code of the most recent error response (status >= 400), from the unified envelope.
  // The repo writes it on error; without it Mongoose strict mode drops it and gw-metrics-get omits it.
  lastErrorCode: String,
});

// Exported for tests.
export const httpMetricSchema = HttpMetricSchema;

HttpMetricSchema.index({ method: 1, route: 1 }, { unique: true });

export const httpMetricModel = {
  provide: HTTP_METRIC_MODEL,
  useFactory: (connection: Connection) => connection.model('http-metric', HttpMetricSchema, 'http-metric'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};
