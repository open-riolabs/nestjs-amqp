import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema } from 'mongoose';
import { AUTH_PROVIDER_MODEL, DATA_CONNECTION_NAME } from '../connections';

const AuthProviderSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  name: String,
  type: String,
  issuer: String,
  audience: String,
  algorithms: [String],
  secret: String,
  jwksUri: String,
  httpsAllowUnauthorized: Boolean,
  clientId: String,
  clientSecret: String,
  scopes: [String],
  tokenUrl: String,
  usernameClaim: String,
  uidClaim: String,
  aclTopic: String,
  aclAction: String,
  jwtMap: [String],
  headerPrefix: String,
  enabled: { type: Boolean, default: true },
});

// Exported for tests.
export const authProviderSchema = AuthProviderSchema;

AuthProviderSchema.index({ name: 1 }, { unique: true });

export const authProviderModel = {
  provide: AUTH_PROVIDER_MODEL,
  useFactory: (connection: Connection) => connection.model('auth-provider', AuthProviderSchema, 'auth-provider'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};
