import { DynamicModule, Module, Provider } from '@nestjs/common';
import { GatewayAdminModuleOptions } from './config/gateway-admin.config';
import { RLB_GW_ADMIN_OPTIONS } from './const';
import { GatewayAuthService } from './services/gateway-auth.service';
import { GatewayMetricsService } from './services/gateway-metrics.service';
import { GatewayPathService } from './services/gateway-path.service';
import { RouteSyncService } from './services/route-sync.service';

const SERVICES: Provider[] = [GatewayPathService, GatewayAuthService, GatewayMetricsService, RouteSyncService];
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
}
