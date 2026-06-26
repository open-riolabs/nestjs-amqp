import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InfluxPointStore } from '../../metrics/influx-point.store';
import { MongooseModule, MongooseModuleFactoryOptions } from '@nestjs/mongoose';
import { stringify } from 'querystring';
import { DATA_CONNECTION_NAME } from './connections';
import { MongoAclActionRepository } from './repository/mongo-acl-action.repository';
import { MongoAclGrantRepository } from './repository/mongo-acl-grant.repository';
import { MongoAclRoleRepository } from './repository/mongo-acl-role.repository';
import { MongoAuthProviderRepository } from './repository/mongo-auth-provider.repository';
import { MongoHttpMetricRepository } from './repository/mongo-http-metric.repository';
import { MongoHttpPathRepository } from './repository/mongo-http-path.repository';
import { MongoRouteSyncLogRepository } from './repository/mongo-route-sync-log.repository';
import { aclActionModel, aclRoleModel } from './schema/acl-action.schema';
import { aclGrantModel } from './schema/acl-grant.schema';
import { authProviderModel } from './schema/auth-provider.schema';
import { httpMetricModel } from './schema/http-metric.schema';
import { httpMetricRollupModel } from './schema/http-metric-rollup.schema';
import { httpPathModel } from './schema/http-path.schema';
import { routeSyncLogModel } from './schema/route-sync-log.schema';

export interface DatabaseConfig {
  protocol: string;
  host: string | string[];
  user: string;
  password: string;
  database: string;
  auth: boolean;
  options?: {
    replicaSet?: string;
    authSource?: string;
    readPreference?: string;
  };
}

const MODELS = [aclActionModel, aclRoleModel, aclGrantModel, httpPathModel, authProviderModel, httpMetricModel, httpMetricRollupModel, routeSyncLogModel];
const REPOSITORIES = [MongoAclActionRepository, MongoAclRoleRepository, MongoAclGrantRepository, MongoHttpPathRepository, MongoAuthProviderRepository, MongoHttpMetricRepository, MongoRouteSyncLogRepository];
@Global()
@Module({
  imports: [
    HttpModule,
    MongooseModule.forRootAsync({
      connectionName: DATA_CONNECTION_NAME,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: dbFactory,
    }),
  ],
  providers: [...MODELS, InfluxPointStore, ...REPOSITORIES],
  exports: [...MODELS, ...REPOSITORIES]
})
export class DatabaseModule { }


export async function dbFactory(config: ConfigService): Promise<MongooseModuleFactoryOptions> {
  const cfg: DatabaseConfig = config.get<DatabaseConfig>("data-mongodb")!;
  let uri = `${cfg.protocol}://`;
  if (cfg.auth && cfg.user && cfg.password) {
    uri += `${cfg.user}:${cfg.password}@`;
  }
  if (Array.isArray(cfg.host)) {
    uri += cfg.host.join(",");
  } else {
    uri += cfg.host;
  }
  if (cfg.options) {
    uri += `?${stringify(cfg.options)}`;
  }
  return {
    uri,
    dbName: cfg.database
  };
}