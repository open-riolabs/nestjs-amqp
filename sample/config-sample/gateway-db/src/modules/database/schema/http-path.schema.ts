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
  // Action names the caller must hold to use this route (OR-semantics); supersedes `roles` gating.
  actions: Schema.Types.Mixed,
  timeout: Number,
  binary: Boolean,
  parseRaw: Boolean,
  successStatusCode: Number,
  redirect: Number,
  headers: Schema.Types.Mixed,
  forwardHeaders: Schema.Types.Mixed,
  enabled: { type: Boolean, default: true },
  // Route auto-discovery: owning service id (null/absent for manually-managed rows) and the
  // stable identity `METHOD path` used by the route-sync for upsert/diff/collision detection.
  owner: String,
  routeKey: String,
  // Provenance ('microservice' = auto-discovered, 'user' = manually managed) and whether a
  // user has edited an auto-discovered row (so the route-sync can skip overwriting it).
  source: String,
  modified: Boolean,
  // Soft per-field user overrides (subset of enabled/actions/allowAnonymous/timeout/redirect/
  // successStatusCode): route auto-discovery preserves these fields' user values while still
  // updating every other field. Released per-field via gw-path-update `releaseOverrides`.
  userOverrides: [String],
});

// Exported for tests.
export const httpPathSchema = HttpPathSchema;

HttpPathSchema.index({ name: 1 }, { unique: true });
HttpPathSchema.index({ owner: 1 });
// `routeKey` (METHOD path) is the stable identity used by route-sync + manual CRUD for upsert/diff/
// collision detection. UNIQUE so it is the authoritative cross-instance guard against duplicate rows
// for the same route (the app-level find-then-insert check is racy). Partial (string-only) so legacy
// rows without a routeKey do not collide on a shared null. The repo maps the resulting duplicate-key
// error (E11000) to ConflictError, which route-sync catches to reconcile the race instead of failing.
HttpPathSchema.index({ routeKey: 1 }, { unique: true, partialFilterExpression: { routeKey: { $type: 'string' } } });
// gateway-auth guards an auth-provider deletion with filter({ auth: name }) — index that lookup.
HttpPathSchema.index({ auth: 1 });

export const httpPathModel = {
  provide: HTTP_PATH_MODEL,
  useFactory: (connection: Connection) => connection.model('http-path', HttpPathSchema, 'http-path'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};
