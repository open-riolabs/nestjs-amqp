import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema } from 'mongoose';
import { ACL_GRANT_MODEL, DATA_CONNECTION_NAME } from '../connections';

const AclGrantSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  resourceBusinessId: String,
  friendlyName: String,
  userId: String,
  resourceId: String,
  roles: [String],
});

// Exported for tests.
export const aclGrantSchema = AclGrantSchema;

AclGrantSchema.index({ userId: 1, resourceId: 1 });

export const aclGrantModel = {
  provide: ACL_GRANT_MODEL,
  useFactory: (connection: Connection) => connection.model('acl-grant', AclGrantSchema, 'acl-grant'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};
