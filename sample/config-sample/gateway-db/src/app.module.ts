import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AclActionRepository, AclGrantRepository, AclModule, AclRoleRepository, AclService, AppConfig, AuthProviderRepository, BrokerModule, BrokerTopic, GatewayAdminModule, GatewayConfig, HandlerAuthConfig, HttpMetricRepository, HttpPathRepository, ProxyModule, RabbitMQConfig, RLB_ACL_CACHE_STORE, RLB_GTW_ACL_ROLE_SERVICE, RLB_GTW_METRICS_HOOK, RouteSyncLogRepository } from '@open-rlb/nestjs-amqp';
import { AppService } from './app.service';
import { InMemoryAclStore } from './cache/in-memory-acl-store';
import yamlConfig from './config/config.loader';
import { InfluxMetricsHook } from './metrics/influx-metrics-hook';
import { DatabaseModule } from './modules/database/database.module';
import { MongoAclActionRepository } from './modules/database/repository/mongo-acl-action.repository';
import { MongoAclGrantRepository } from './modules/database/repository/mongo-acl-grant.repository';
import { MongoAclRoleRepository } from './modules/database/repository/mongo-acl-role.repository';
import { MongoAuthProviderRepository } from './modules/database/repository/mongo-auth-provider.repository';
import { MongoHttpMetricRepository } from './modules/database/repository/mongo-http-metric.repository';
import { MongoHttpPathRepository } from './modules/database/repository/mongo-http-path.repository';
import { MongoRouteSyncLogRepository } from './modules/database/repository/mongo-route-sync-log.repository';



@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    DatabaseModule,
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        options: configService.get<RabbitMQConfig>('broker')!,
        topics: configService.get<BrokerTopic[]>('topics')!,
        appOptions: configService.get<AppConfig>('app'),
      })
    }),
    HttpModule,
    ProxyModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        authOptions: configService.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: configService.get<GatewayConfig>('gateway'),
      }),
      providers: [
        // In-process action gate: action-protected paths (e.g. /protected) resolve the caller's
        // grants via AclService.checkAction instead of a broker round-trip.
        { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService },
        // In-proxy metrics hook → InfluxDB (no-op until INFLUX_URL/TOKEN/ORG env are set).
        { provide: RLB_GTW_METRICS_HOOK, useClass: InfluxMetricsHook },
      ],
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
      // Route auto-discovery (gateway side): RouteSyncService is wired by GatewayAdminModule and
      // requires the journal repository to record each added/updated/removed/collision event.
      { provide: RouteSyncLogRepository, useExisting: MongoRouteSyncLogRepository },
    ]),

  ],
  providers: [AppService],
})
export class AppModule { }
