import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule, MongooseModuleFactoryOptions } from '@nestjs/mongoose';
import {
  AclActionRepository,
  AclGrantRepository,
  AclRoleRepository,
  AuthProviderRepository,
  HttpMetricRepository,
  HttpPathRepository,
} from '@open-rlb/nestjs-amqp';
import { DATA_CONNECTION_NAME } from './connections';
import { MongoAclActionRepository } from './repository/mongo-acl-action.repository';
import { MongoAclGrantRepository } from './repository/mongo-acl-grant.repository';
import { MongoAclRoleRepository } from './repository/mongo-acl-role.repository';
import { MongoAuthProviderRepository } from './repository/mongo-auth-provider.repository';
import { MongoHttpMetricRepository } from './repository/mongo-http-metric.repository';
import { MongoHttpPathRepository } from './repository/mongo-http-path.repository';
import { aclActionModel, aclRoleModel } from './schema/acl-action.schema';
import { aclGrantModel } from './schema/acl-grant.schema';
import { authProviderModel } from './schema/auth-provider.schema';
import { httpMetricModel } from './schema/http-metric.schema';
import { httpPathModel } from './schema/http-path.schema';

interface MongoConfig { uri: string; dbName?: string; }

const MODELS = [aclActionModel, aclRoleModel, aclGrantModel, httpPathModel, authProviderModel, httpMetricModel];

// Bind the lib's abstract repository contracts to the concrete Mongo implementations.
const REPOSITORIES = [
  { provide: AclActionRepository, useClass: MongoAclActionRepository },
  { provide: AclRoleRepository, useClass: MongoAclRoleRepository },
  { provide: AclGrantRepository, useClass: MongoAclGrantRepository },
  { provide: HttpPathRepository, useClass: MongoHttpPathRepository },
  { provide: AuthProviderRepository, useClass: MongoAuthProviderRepository },
  { provide: HttpMetricRepository, useClass: MongoHttpMetricRepository },
];

/**
 * Single data module for this microservice (chatbot-ms style): owns the one Mongoose
 * connection, registers all schema models and repositories, and exports them. Global so
 * the lib's AclModule/GatewayAdminModule services resolve the repository contracts.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      connectionName: DATA_CONNECTION_NAME,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MongooseModuleFactoryOptions => {
        const cfg = config.get<MongoConfig>('mongo')!;
        return { uri: cfg.uri, dbName: cfg.dbName };
      },
    }),
  ],
  providers: [...MODELS, ...REPOSITORIES],
  exports: [...MODELS, ...REPOSITORIES.map((r) => r.provide)],
})
export class DatabaseModule { }
