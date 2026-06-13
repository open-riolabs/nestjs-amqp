import { DynamicModule, Module, Provider } from '@nestjs/common';
import { AclModuleOptions } from './config/acl.config';
import { RLB_ACL_OPTIONS } from './const';
import { AclCacheService } from './cache/acl-cache.service';
import { AclManagementService } from './services/acl-management.service';
import { AclService } from './services/acl.service';

const SERVICES: Provider[] = [AclCacheService, AclService, AclManagementService];
const MODULE_EXPORTS = [AclService, AclCacheService];

@Module({})
export class AclModule {
  /**
   * @param providers DI bindings supplied by the consuming app: the concrete repositories
   *   bound to the abstract AclActionRepository / AclRoleRepository / AclGrantRepository
   *   tokens, and optionally the RLB_ACL_CACHE_STORE L2 implementation.
   * @param options cache TTLs / topic.
   */
  static forRoot(providers: Provider[], options: AclModuleOptions = {}): DynamicModule {
    return {
      module: AclModule,
      global: true,
      providers: [
        { provide: RLB_ACL_OPTIONS, useValue: options },
        ...providers,
        ...SERVICES,
      ],
      exports: MODULE_EXPORTS,
    };
  }
}
