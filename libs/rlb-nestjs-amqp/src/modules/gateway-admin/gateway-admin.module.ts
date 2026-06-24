import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { GatewayAdminModuleOptions } from './config/gateway-admin.config';
import { RLB_GW_ADMIN_OPTIONS } from './const';
import { GatewayAuthService } from './services/gateway-auth.service';
import { GatewayHealthService } from './services/gateway-health.service';
import { GatewayMetricsRollupService } from './services/gateway-metrics-rollup.service';
import { GatewayMetricsService } from './services/gateway-metrics.service';
import { GatewayPathService } from './services/gateway-path.service';
import { GatewayRetentionService } from './services/gateway-retention.service';
import { RouteSyncService } from './services/route-sync.service';

const SERVICES: Provider[] = [GatewayPathService, GatewayAuthService, GatewayMetricsService, GatewayMetricsRollupService, GatewayHealthService, GatewayRetentionService, RouteSyncService];
const MODULE_EXPORTS = [GatewayPathService, GatewayAuthService, GatewayMetricsService];

@Module({})
export class GatewayAdminModule {
  /**
   * @param providers DI bindings supplied by the consuming app: the concrete repositories
   *   bound to the abstract HttpPathRepository / AuthProviderRepository / HttpMetricRepository.
   */
  static forRoot(providers: Provider[], options: GatewayAdminModuleOptions = {}): DynamicModule {
    return {
      module: GatewayAdminModule,
      providers: [
        { provide: RLB_GW_ADMIN_OPTIONS, useValue: options },
        ...providers,
        ...SERVICES,
      ],
      exports: MODULE_EXPORTS,
    };
  }

  /**
   * Async setup: resolve {@link GatewayAdminModuleOptions} (e.g. the consumer-side `routeDiscovery`
   * exchange/queue) from a factory such as ConfigService. `providers` carries the repository bindings.
   */
  static forRootAsync(asyncOptions: {
    imports?: Type<any>[];
    inject?: Type<any>[];
    useFactory: (...args: any[]) => Promise<GatewayAdminModuleOptions> | GatewayAdminModuleOptions;
    providers?: Provider[];
  }): DynamicModule {
    const optionsProvider: Provider = {
      provide: RLB_GW_ADMIN_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject || [],
    };
    return {
      module: GatewayAdminModule,
      imports: asyncOptions.imports || [],
      providers: [optionsProvider, ...(asyncOptions.providers || []), ...SERVICES],
      exports: MODULE_EXPORTS,
    };
  }
}
