import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, MongooseModuleFactoryOptions } from '@nestjs/mongoose';
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

export interface DatabaseConfig {
  protocol: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  auth: boolean;
}

const MODELS = [aclActionModel, aclRoleModel, aclGrantModel, httpPathModel, authProviderModel, httpMetricModel];
const REPOSITORIES = [MongoAclActionRepository, MongoAclRoleRepository, MongoAclGrantRepository, MongoHttpPathRepository, MongoAuthProviderRepository, MongoHttpMetricRepository];
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      connectionName: DATA_CONNECTION_NAME,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: dbFactory,
    }),
  ],
  providers: [...MODELS, ...REPOSITORIES],
  exports: [...MODELS, ...REPOSITORIES]
})
export class DatabaseModule { }


export async function dbFactory(config: ConfigService): Promise<MongooseModuleFactoryOptions> {
  const cfg: DatabaseConfig = config.get<DatabaseConfig>("data-mongodb");
  let uri = `mongodb://${cfg.host}:${cfg.port}`;
  if (cfg.auth && cfg.user && cfg.password) {
    uri = `mongodb://${cfg.user}:${cfg.password}@${cfg.host}:${cfg.port}`;
  }
  return { uri, dbName: cfg.database };
}
