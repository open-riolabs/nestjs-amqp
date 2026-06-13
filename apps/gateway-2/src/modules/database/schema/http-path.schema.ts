import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema } from 'mongoose';
import { DATA_CONNECTION_NAME, HTTP_PATH_MODEL } from '../connections';

const HttpPathSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  name: String,
  method: String,
  path: String,
  dataSource: String,
  topic: String,
  action: String,
  mode: String,
  auth: String,
  allowAnonymous: Boolean,
  roles: [String],
  timeout: Number,
  binary: Boolean,
  parseRaw: Boolean,
  successStatusCode: Number,
  redirect: Number,
  headers: Schema.Types.Mixed,
  forwardHeaders: Schema.Types.Mixed,
  enabled: { type: Boolean, default: true },
});

// Exported for tests.
export const httpPathSchema = HttpPathSchema;

HttpPathSchema.index({ name: 1 }, { unique: true });

export const httpPathModel = {
  provide: HTTP_PATH_MODEL,
  useFactory: (connection: Connection) => connection.model('http-path', HttpPathSchema, 'http-path'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};
