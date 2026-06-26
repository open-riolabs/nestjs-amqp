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
  RLB_GTW_AUTH_PROVIDER_SOURCE,
  RLB_GTW_METRICS_HOOK,
  RouteSyncLogRepository,
} from '@open-rlb/nestjs-amqp';
import { InMemoryAclStore } from './cache/in-memory-acl-store';
import yamlConfig from './config/config.loader';
import { DatabaseModule } from './modules/database/database.module';
import {
  InMemoryAclActionRepository,
  InMemoryAclGrantRepository,
  InMemoryAclRoleRepository,
} from './modules/database/repository/acl.repository';
import {
  InMemoryAuthProviderRepository,
  InMemoryHttpMetricRepository,
  InMemoryHttpPathRepository,
} from './modules/database/repository/gateway.repository';
import { InMemoryRouteSyncLogRepository } from './modules/database/repository/route-sync.repository';
import { InfluxMetricsHook } from './metrics/influx-metrics-hook';
import { RouteDiscoveryDemoService } from './samples/route-discovery-demo.service';

@Module({
  imports: [
    HttpModule,
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    DatabaseModule,
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        // routeDiscovery (publisher side) now lives INSIDE the broker config block.
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
      providers: [
        { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService },
        // DB auth-provider source for the runtime registry; activated by a deliberate gw-auth-reload.
        { provide: RLB_GTW_AUTH_PROVIDER_SOURCE, useExisting: InMemoryAuthProviderRepository },
        // Example in-proxy metrics hook → InfluxDB (no-op until INFLUX_URL/TOKEN/ORG env are set).
        { provide: RLB_GTW_METRICS_HOOK, useClass: InfluxMetricsHook },
      ],
    }),
    AclModule.forRoot(
      [
        { provide: AclActionRepository, useExisting: InMemoryAclActionRepository },
        { provide: AclRoleRepository, useExisting: InMemoryAclRoleRepository },
        { provide: AclGrantRepository, useExisting: InMemoryAclGrantRepository },
        InMemoryAclStore,
        { provide: RLB_ACL_CACHE_STORE, useExisting: InMemoryAclStore },
      ],
      { cache: { ramTtlMs: 30000, l2TtlSec: 600 } },
    ),
    GatewayAdminModule.forRoot([
      { provide: HttpPathRepository, useExisting: InMemoryHttpPathRepository },
      { provide: AuthProviderRepository, useExisting: InMemoryAuthProviderRepository },
      { provide: HttpMetricRepository, useExisting: InMemoryHttpMetricRepository },
      // Route auto-discovery (gateway side): RouteSyncService is wired by GatewayAdminModule;
      // the journal log collection is consumer-provided. The publisher side lives in BrokerModule
      // (a microservice announcing itself), activated by the `broker.routeDiscovery` config.
      { provide: RouteSyncLogRepository, useExisting: InMemoryRouteSyncLogRepository },
    ]),
  ],
  providers: [RouteDiscoveryDemoService],
})
export class AppModule { }
