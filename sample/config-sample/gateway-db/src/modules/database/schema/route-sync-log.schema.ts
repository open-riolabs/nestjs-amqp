import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema } from 'mongoose';
import { DATA_CONNECTION_NAME, ROUTE_SYNC_LOG_MODEL } from '../connections';

/**
 * Persistent journal of route auto-discovery events: one row per added/updated/removed/collision/
 * invalid/reload. Lets you audit what each microservice announced and why a route was (or was not)
 * applied to the gateway DB.
 */
const RouteSyncLogSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  ts: { type: Number, index: true },
  service: String,
  level: String,
  event: String,
  routeKey: String,
  method: String,
  path: String,
  topic: String,
  action: String,
  owner: String,
  conflictWith: String,
  message: String,
});

// Exported for tests.
export const routeSyncLogSchema = RouteSyncLogSchema;

RouteSyncLogSchema.index({ service: 1, ts: -1 });

export const routeSyncLogModel = {
  provide: ROUTE_SYNC_LOG_MODEL,
  useFactory: (connection: Connection) => connection.model('route-sync-log', RouteSyncLogSchema, 'route-sync-log'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};
