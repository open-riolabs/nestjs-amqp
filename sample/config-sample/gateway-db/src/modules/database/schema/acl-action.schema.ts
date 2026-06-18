import { getConnectionToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema } from 'mongoose';
import { ACL_ACTION_MODEL, ACL_ROLE_MODEL, DATA_CONNECTION_NAME } from '../connections';

const AclActionSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  name: String,
  description: String,
});

const AclRoleSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  name: String,
  description: String,
  actions: [String],
});

// Exported for tests.
export const aclActionSchema = AclActionSchema;
export const aclRoleSchema = AclRoleSchema;

AclActionSchema.index({ name: 1 }, { unique: true });
AclRoleSchema.index({ name: 1 }, { unique: true });

export const aclActionModel = {
  provide: ACL_ACTION_MODEL,
  // Explicit collection name (3rd arg) so Mongoose does NOT pluralize it: ACL roles/grants
  // reference actions/roles by their literal collection name ('acl-action' / 'acl-role').
  useFactory: (connection: Connection) => connection.model('acl-action', AclActionSchema, 'acl-action'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};

export const aclRoleModel = {
  provide: ACL_ROLE_MODEL,
  useFactory: (connection: Connection) => connection.model('acl-role', AclRoleSchema, 'acl-role'),
  inject: [getConnectionToken(DATA_CONNECTION_NAME)],
};
