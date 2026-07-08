import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  InMemoryAclActionRepository,
  InMemoryAclGrantRepository,
  InMemoryAclRoleRepository,
} from '../modules/database/repository/acl.repository';

/**
 * Demo-only bootstrap so the cross-instance invalidation flow (HARDENING #2) is runnable end-to-end
 * without seeding the DB out-of-band. It creates:
 *   - actions: `gateway-access` (gate for /protected), `role-management` (gate for grant/revoke)
 *   - roles:   `reader` → [gateway-access],  `admin` → [role-management]
 *   - grant:   user `admin` holds `admin` (resource-less) so Basic admin:secret can grant/revoke.
 *
 * NOT part of the library — a real deployment seeds the first role-management grant out-of-band.
 * Idempotent, so it is safe when several in-memory instances each seed their own RAM.
 */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly actions: InMemoryAclActionRepository,
    private readonly roles: InMemoryAclRoleRepository,
    private readonly grants: InMemoryAclGrantRepository,
  ) { }

  async onApplicationBootstrap(): Promise<void> {
    await this.actions.upsertOne({ name: 'gateway-access' }, { name: 'gateway-access', description: 'Access the protected route' });
    await this.actions.upsertOne({ name: 'role-management' }, { name: 'role-management', description: 'Grant/revoke roles' });
    await this.roles.upsertOne({ name: 'reader' }, { name: 'reader', actions: ['gateway-access'] });
    await this.roles.upsertOne({ name: 'admin' }, { name: 'admin', actions: ['role-management'] });

    const existing = await this.grants.filter({ userId: 'admin' });
    if (!existing.some((g) => !g.resourceId && !g.companyId)) {
      await this.grants.insert({ userId: 'admin', roles: ['admin'] });
    }
    this.logger.log("[seed] ready — Basic admin:secret can grant 'reader' (gateway-access) to other users");
  }
}
