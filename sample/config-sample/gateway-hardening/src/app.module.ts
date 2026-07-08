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
  RLB_GW_SCHED_LOCK,
  RouteSyncLogRepository,
} from '@open-rlb/nestjs-amqp';
import { InMemoryAclStore } from './cache/in-memory-acl-store';
import yamlConfig from './config/config.loader';
import { InMemorySchedulerLock } from './hardening/in-memory-scheduler-lock';
import { SeedService } from './hardening/seed.service';
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

/**
 * HARDENING #2 — cross-instance ACL cache invalidation exchange. Must match a fanout exchange
 * declared in config.yaml (broker.exchanges) so every instance's ephemeral queue binds to it.
 */
const ACL_INVALIDATION_EXCHANGE = 'rlb-acl-invalidate';

/**
 * Sample AppModule wiring ONLY the multi-instance hardening features:
 *   #2 cross-instance ACL cache invalidation  → AclModule `invalidation` option (below)
 *   #3 bounded ACL RAM cache                   → AclModule `cache.maxRamEntries` (below)
 *   #4 scheduler lock for rollup/retention     → RLB_GW_SCHED_LOCK provider (below)
 *   #5 body-size limit + concurrency cap       → gateway.maxBodyBytes (main.ts) + gateway.maxConcurrentRequests (config.yaml)
 * Everything else (repos, L2 store) is in-memory scaffolding so only RabbitMQ is required.
 */
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
        // gateway config carries HARDENING #5's `maxConcurrentRequests` (in-flight cap → 503)
        // and `maxBodyBytes` (read again in main.ts to size the body parser).
        gatewayOptions: config.get<GatewayConfig>('gateway'),
      }),
      providers: [
        // In-process ACL check for action-protected routes (no broker round-trip).
        { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService },
        { provide: RLB_GTW_AUTH_PROVIDER_SOURCE, useExisting: InMemoryAuthProviderRepository },
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
      {
        cache: {
          ramTtlMs: 30000,
          l2TtlSec: 600,
          // HARDENING #3: hard cap on L1 (RAM) entries — evicts oldest beyond this (default 50000).
          maxRamEntries: 50000,
        },
        // HARDENING #2: on grant/revoke/role/action changes, broadcast an invalidation so every
        // OTHER instance flushes its L1 RAM at once (instead of waiting out ramTtlMs). No-op if the
        // exchange/AmqpConnection is absent. Run TWO instances to see it (see README).
        invalidation: { exchange: ACL_INVALIDATION_EXCHANGE, routingKey: 'acl-invalidate' },
      },
    ),
    GatewayAdminModule.forRoot([
      { provide: HttpPathRepository, useExisting: InMemoryHttpPathRepository },
      { provide: AuthProviderRepository, useExisting: InMemoryAuthProviderRepository },
      { provide: HttpMetricRepository, useExisting: InMemoryHttpMetricRepository },
      { provide: RouteSyncLogRepository, useExisting: InMemoryRouteSyncLogRepository },
      // HARDENING #4: an optional distributed lock so the hourly rollup + daily retention jobs run
      // on ONE instance per tick. Swap InMemorySchedulerLock for a Redis/Mongo-backed one to make it
      // effective across processes (see the reference snippets in that file).
      InMemorySchedulerLock,
      { provide: RLB_GW_SCHED_LOCK, useExisting: InMemorySchedulerLock },
    ]),
  ],
  // Demo-only ACL bootstrap (see SeedService) so the invalidation flow is runnable end-to-end.
  providers: [SeedService],
})
export class AppModule { }
