import { brokerModuleEntry, configModuleEntry, WireEntry } from '../utils/nest-wiring.util';

/**
 * The AppModule wiring for a gateway: the lib symbols to import, the helper import lines, and the
 * `@Module` imports[] entries with idempotency sentinels. Mirrors what nest-add generated for the
 * gateway case, now owned by add-gateway so a promote-to-gateway run wires a working app.
 * HttpModule / ProxyModule share the `ProxyModule.forRootAsync` sentinel (the gateway pair), so both
 * are added together when absent and skipped together on a re-run.
 */

export interface GwFeatures {
  acl: boolean;
  admin: boolean;
  routeReception: boolean;
  routeExchange: string;
  routeQueue: string;
}

export function libSymbols(f: GwFeatures): string[] {
  const s = ['AppConfig', 'BrokerModule', 'BrokerTopic', 'GatewayConfig', 'HandlerAuthConfig', 'ProxyModule', 'RabbitMQConfig'];
  if (f.acl) s.push('AclActionRepository', 'AclGrantRepository', 'AclModule', 'AclRoleRepository', 'AclService', 'RLB_ACL_CACHE_STORE', 'RLB_GTW_ACL_ROLE_SERVICE');
  if (f.admin || f.routeReception) s.push('AuthProviderRepository', 'GatewayAdminModule', 'HttpMetricRepository', 'HttpPathRepository', 'RouteSyncLogRepository');
  if (f.admin) s.push('RLB_GTW_AUTH_PROVIDER_SOURCE');
  return s;
}

export function importLines(f: GwFeatures): { line: string; marker: string }[] {
  const lines = [
    { line: `import { ConfigModule, ConfigService } from '@nestjs/config';`, marker: '@nestjs/config' },
    { line: `import yamlConfig from './config/config.loader';`, marker: './config/config.loader' },
    { line: `import { HttpModule } from '@nestjs/axios';`, marker: '@nestjs/axios' },
  ];
  if (f.acl) {
    lines.push({ line: `import { InMemoryAclActionRepository, InMemoryAclGrantRepository, InMemoryAclRoleRepository } from './modules/database/repository/acl.repository';`, marker: './modules/database/repository/acl.repository' });
    lines.push({ line: `import { InMemoryAclStore } from './cache/in-memory-acl-store';`, marker: './cache/in-memory-acl-store' });
  }
  if (f.admin || f.routeReception) {
    lines.push({ line: `import { InMemoryAuthProviderRepository, InMemoryHttpMetricRepository, InMemoryHttpPathRepository } from './modules/database/repository/gateway.repository';`, marker: './modules/database/repository/gateway.repository' });
    lines.push({ line: `import { InMemoryRouteSyncLogRepository } from './modules/database/repository/route-sync.repository';`, marker: './modules/database/repository/route-sync.repository' });
  }
  return lines;
}

const GATEWAY_SENTINEL = 'ProxyModule.forRootAsync';

export function moduleEntries(f: GwFeatures): WireEntry[] {
  // ConfigModule + BrokerModule come from the shared core builders (single source of truth with nest-add).
  const entries: WireEntry[] = [
    configModuleEntry(),
    brokerModuleEntry(),
    { code: `HttpModule`, sentinel: GATEWAY_SENTINEL },
    { code: proxyForRootAsync(f), sentinel: GATEWAY_SENTINEL },
  ];
  if (f.acl) entries.push({ code: aclForRoot(), sentinel: 'AclModule.forRoot' });
  if (f.admin || f.routeReception) entries.push({ code: gatewayAdminForRoot(f), sentinel: 'GatewayAdminModule.forRoot' });
  return entries;
}

function proxyForRootAsync(f: GwFeatures): string {
  const provs: string[] = [];
  if (f.acl)
    provs.push(`        // Action-gated paths resolve the caller's identity via AclService (in-process, no broker hop).
        { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService },`);
  if (f.admin)
    provs.push(`        // DB auth-provider source for the runtime registry; activated by a deliberate gw-auth-reload.
        { provide: RLB_GTW_AUTH_PROVIDER_SOURCE, useExisting: InMemoryAuthProviderRepository },`);
  const providers = provs.length ? `[\n${provs.join('\n')}\n      ]` : `[]`;
  return `ProxyModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        authOptions: configService.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: configService.get<GatewayConfig>('gateway'),
      }),
      providers: ${providers},
    })`;
}

function aclForRoot(): string {
  return `AclModule.forRoot(
      [
        InMemoryAclActionRepository,
        { provide: AclActionRepository, useExisting: InMemoryAclActionRepository },
        InMemoryAclRoleRepository,
        { provide: AclRoleRepository, useExisting: InMemoryAclRoleRepository },
        InMemoryAclGrantRepository,
        { provide: AclGrantRepository, useExisting: InMemoryAclGrantRepository },
        InMemoryAclStore,
        { provide: RLB_ACL_CACHE_STORE, useExisting: InMemoryAclStore },
      ],
      { cache: { ramTtlMs: 30000, l2TtlSec: 600 } },
    )`;
}

function gatewayAdminForRoot(f: GwFeatures): string {
  const options = f.routeReception
    ? `,
      {
        // Consumer-side route-discovery — names MUST match the publishers' broker.routeDiscovery.
        routeDiscovery: { exchange: '${f.routeExchange}', queue: '${f.routeQueue}' },
      }`
    : '';
  return `GatewayAdminModule.forRoot(
      [
        InMemoryHttpPathRepository,
        { provide: HttpPathRepository, useExisting: InMemoryHttpPathRepository },
        InMemoryAuthProviderRepository,
        { provide: AuthProviderRepository, useExisting: InMemoryAuthProviderRepository },
        InMemoryHttpMetricRepository,
        { provide: HttpMetricRepository, useExisting: InMemoryHttpMetricRepository },
        InMemoryRouteSyncLogRepository,
        { provide: RouteSyncLogRepository, useExisting: InMemoryRouteSyncLogRepository },
      ]${options},
    )`;
}
