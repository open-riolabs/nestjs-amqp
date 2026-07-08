import { DynamicModule, Module, Provider } from '@nestjs/common';
import { AclModuleOptions } from './config/acl.config';
import { RLB_ACL_INVALIDATION, RLB_ACL_OPTIONS } from './const';
import { AclCacheService } from './cache/acl-cache.service';
import { AclInvalidationService } from './services/acl-invalidation.service';
import { AclManagementService } from './services/acl-management.service';
import { AclService } from './services/acl.service';

const SERVICES: Provider[] = [AclCacheService, AclService, AclInvalidationService, AclManagementService];
const MODULE_EXPORTS = [AclService, AclCacheService];

@Module({})
export class AclModule {
  /**
   * @param providers DI bindings supplied by the consuming app: the concrete repositories
   *   bound to the abstract AclActionRepository / AclRoleRepository / AclGrantRepository
   *   tokens, and optionally the RLB_ACL_CACHE_STORE L2 implementation.
   * @param options cache TTLs.
   */
  static forRoot(providers: Provider[], options: AclModuleOptions = {}): DynamicModule {
    return {
      module: AclModule,
      global: true,
      providers: [
        { provide: RLB_ACL_OPTIONS, useValue: options },
        { provide: RLB_ACL_INVALIDATION, useValue: options.invalidation },
        ...providers,
        ...SERVICES,
      ],
      exports: MODULE_EXPORTS,
    };
  }
}
