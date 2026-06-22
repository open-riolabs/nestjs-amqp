import { Injectable, Logger } from '@nestjs/common';
import { UnauthorizedError } from '../../../common';
import { BrokerAction, BrokerParam } from '../../broker';
import { IAclRoleService } from '../../proxy/services/acl.service';
import { AclCacheService } from '../cache/acl-cache.service';
import { AclResourceContext, grantMatchesResource } from '../authz-match';
import { ACL_ACTIONS, ACL_TOPIC } from '../const';
import { AclResourceGroup } from '../models';
import { AclGrantRepository } from '../repository/acl-grant.repository';
import { AclRoleRepository } from '../repository/acl-role.repository';

@Injectable()
export class AclService implements IAclRoleService {
  private readonly logger = new Logger(AclService.name);

  constructor(
    private readonly grants: AclGrantRepository,
    private readonly roles: AclRoleRepository,
    private readonly cache: AclCacheService,
  ) { }

  private toList(value: string | string[]): string[] {
    return Array.isArray(value) ? value : (value ? [value] : []);
  }

  /**
   * The single ACL authorization primitive. True when `userId` holds at least one of `action` —
   * via any role that includes it — on the EXACT (companyId, resourceId) in `ctx`. Match is strict
   * (no wildcard); the sole carve-out is both ids absent on request AND grant. `ctx === undefined`
   * skips resource scoping (used by WebSocket events, which carry no resource).
   */
  async checkAction(userId: string, ctx: AclResourceContext | undefined, action: string | string[]): Promise<boolean> {
    const actions = this.toList(action);
    if (!userId || !actions.length) return false;
    const scopeKey = ctx === undefined ? 'agnostic' : `${ctx.companyId ?? '*'}|${ctx.resourceId ?? '*'}`;
    const cacheAction = `act:${scopeKey}:${[...actions].sort().join(',')}`;
    const cached = await this.cache.get(userId, cacheAction);
    if (cached !== null) return cached;
    // Resolve the requested action(s) to the role names that include any of them. JS-side
    // resolution keeps this portable across consumer repos (no array-contains filter needed).
    const allRoles = await this.roles.list();
    const roleNames = new Set(
      (allRoles || []).filter((r) => (r.actions || []).some((a) => actions.includes(a))).map((r) => r.name),
    );
    let allowed = false;
    if (roleNames.size) {
      const grants = await this.grants.filter({ userId });
      const scoped = ctx === undefined ? grants : grants.filter((g) => grantMatchesResource(g, ctx));
      allowed = scoped.some((g) => (g.roles || []).some((r) => roleNames.has(r)));
    }
    await this.cache.set(userId, cacheAction, allowed);
    return allowed;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.checkAction, 'rpc')
  async handleCheckAction(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'action') action: string | string[],
    @BrokerParam('body', 'companyId') companyId?: string,
    @BrokerParam('body', 'resourceId') resourceId?: string,
  ): Promise<boolean> {
    try {
      return await this.checkAction(userId, { companyId, resourceId }, action);
    } catch (error) {
      this.logger.error(error);
      return false;
    }
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.listResourcesByUser, 'rpc')
  async listResourcesByUser(
    @BrokerParam('header', 'X-GTW-AUTH-USERID') userId: string,
  ): Promise<AclResourceGroup[]> {
    try {
      if (!userId) throw new UnauthorizedError('User ID is required');
      const acls = await this.grants.filter({ userId });
      const grouped: Record<string, AclResourceGroup> = {};
      for (const item of acls || []) {
        const companyKey = item.companyId ?? '';
        if (!grouped[companyKey]) {
          grouped[companyKey] = { companyId: item.companyId, resources: [] };
        }
        let resource = grouped[companyKey].resources.find((r) => r.resourceId === item.resourceId);
        if (!resource) {
          resource = { resourceId: item.resourceId, actions: [], friendlyName: item.friendlyName };
          grouped[companyKey].resources.push(resource);
        }
        const roleNames = Array.isArray(item.roles) ? item.roles : [item.roles];
        const actions = await this.roles.getActionsByNames(roleNames);
        resource.actions.push(...actions);
        resource.actions = Array.from(new Set(resource.actions));
      }
      return Object.values(grouped);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

}
