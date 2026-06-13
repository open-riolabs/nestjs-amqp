import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AclModule,
  AclService,
  AppConfig,
  BrokerModule,
  BrokerTopic,
  GatewayAdminModule,
  GatewayConfig,
  HandlerAuthConfig,
  ProxyModule,
  RabbitMQConfig,
  RLB_ACL_CACHE_STORE,
  RLB_GTW_ACL_ROLE_SERVICE,
} from '@open-rlb/nestjs-amqp';
import { RedisModule, SingleOptions } from '@rlb-core/lib-nestjs-redis';
import { ACL_REDIS_NAMESPACE, RedisAclStore } from './cache/redis-acl-store';
import yamlConfig from './config/config.loader';
import { DatabaseModule } from './modules/database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    // Single data module: owns the connection, models and repository contracts (global).
    DatabaseModule,
    RedisModule.registerAsync(ACL_REDIS_NAMESPACE, {
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ type: 'single', options: config.get<SingleOptions>('redis') }),
    }),
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        options: config.get<RabbitMQConfig>('broker') as RabbitMQConfig,
        topics: config.get<BrokerTopic[]>('topics'),
        appOptions: config.get<AppConfig>('app'),
        authOptions: config.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: config.get<GatewayConfig>('gateway'),
      }),
    }),
    HttpModule,
    ProxyModule.forRoot([{ provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService }]),
    // Repositories come from DatabaseModule (global). Here we only add the L2 cache store.
    AclModule.forRoot(
      [RedisAclStore, { provide: RLB_ACL_CACHE_STORE, useExisting: RedisAclStore }],
      { cache: { ramTtlMs: 30000, l2TtlSec: 600 } },
    ),
    GatewayAdminModule.forRoot([]),
  ],
})
export class AppModule { }
