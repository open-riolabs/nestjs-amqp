import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AclActionRepository,
  AclGrantRepository,
  AclModule,
  AclRoleRepository,
  AclService,
  AppConfig,
  AuthProviderRepository,
  BrokerModule,
  BrokerTopic,
  GatewayAdminModule,
  GatewayConfig,
  HandlerAuthConfig,
  HttpMetricRepository,
  HttpPathRepository,
  ProxyModule,
  RabbitMQConfig,
  RLB_ACL_CACHE_STORE,
  RLB_GTW_ACL_ROLE_SERVICE,
} from '@open-rlb/nestjs-amqp';
import { InMemoryAclStore } from './cache/in-memory-acl-store';
import yamlConfig from './config/config.loader';
import {
  DatabaseModule
} from './modules/database/database.module';
import { MongoAclActionRepository } from './modules/database/repository/mongo-acl-action.repository';
import { MongoAclGrantRepository } from './modules/database/repository/mongo-acl-grant.repository';
import { MongoAclRoleRepository } from './modules/database/repository/mongo-acl-role.repository';
import { MongoAuthProviderRepository } from './modules/database/repository/mongo-auth-provider.repository';
import { MongoHttpMetricRepository } from './modules/database/repository/mongo-http-metric.repository';
import { MongoHttpPathRepository } from './modules/database/repository/mongo-http-path.repository';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    DatabaseModule,
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        options: config.get<RabbitMQConfig>('broker') as RabbitMQConfig,
        topics: config.get<BrokerTopic[]>('topics'),
        appOptions: config.get<AppConfig>('app'),
      }),
    }),
    ProxyModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        authOptions: config.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: config.get<GatewayConfig>('gateway'),
      }),
      providers: [{ provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService }],
    }),
    AclModule.forRoot(
      [
        { provide: AclActionRepository, useExisting: MongoAclActionRepository },
        { provide: AclRoleRepository, useExisting: MongoAclRoleRepository },
        { provide: AclGrantRepository, useExisting: MongoAclGrantRepository },
        InMemoryAclStore,
        { provide: RLB_ACL_CACHE_STORE, useExisting: InMemoryAclStore },
      ],
      { cache: { ramTtlMs: 30000, l2TtlSec: 600 } },
    ),
    GatewayAdminModule.forRoot([
      { provide: HttpPathRepository, useExisting: MongoHttpPathRepository },
      { provide: AuthProviderRepository, useExisting: MongoAuthProviderRepository },
      { provide: HttpMetricRepository, useExisting: MongoHttpMetricRepository },
    ]),
  ],
})
export class AppModule { }
