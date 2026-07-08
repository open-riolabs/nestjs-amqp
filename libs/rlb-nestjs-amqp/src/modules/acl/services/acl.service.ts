import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnauthorizedError } from '../../../common';
import { BrokerAction, BrokerParam } from '../../broker';
import { IAclRoleService } from '../../proxy/services/acl.service';
import { AclResourceContext, grantMatchesResource } from '../auth-match';
import { AclCacheService } from '../cache/acl-cache.service';
import { AclModuleOptions } from '../config/acl.config';
import { ACL_ACTIONS, ACL_TOPIC, RLB_ACL_OPTIONS } from '../const';
import { AclResourceGroup, AclRole } from '../models';
import { AclGrantRepository } from '../repository/acl-grant.repository';
import { AclRoleRepository } from '../repository/acl-role.repository';

@Injectable()
export class AclService implements IAclRoleService {
  private readonly logger = new Logger(AclService.name);
  /** Short-lived memo of the whole roles collection, so a cache-miss check does not re-scan it every
   *  time. Bounded staleness matches the decision cache; role mutations clear it (invalidateRolesCache). */
  private rolesCache?: { data: AclRole[]; exp: number; };
  private readonly rolesTtlMs: number;

  constructor(
    private readonly grants: AclGrantRepository,
    private readonly roles: AclRoleRepository,
    private readonly cache: AclCacheService,
    @Inject(RLB_ACL_OPTIONS) options: AclModuleOptions,
  ) {
    this.rolesTtlMs = options?.cache?.ramTtlMs ?? 30_000;
  }

  private toList(value: string | string[]): string[] {
    return Array.isArray(value) ? value : (value ? [value] : []);
  }

  /**
   * The roles collection, memoized for `rolesTtlMs`. `checkAction` needs "which roles include this
   * action", which has no targeted query (portable, no array-contains filter), so it would otherwise
   * scan the whole collection on every cache miss. Cleared by role/action mutations
   * (invalidateRolesCache) locally and — when configured — across instances via the invalidation
   * broadcast, so a role change is never masked for longer than the TTL.
   */
  private async listRolesCached(): Promise<AclRole[]> {
    const now = Date.now();
    if (this.rolesCache && this.rolesCache.exp > now) return this.rolesCache.data;
    const data = (await this.roles.list()) || [];
    this.rolesCache = { data, exp: now + this.rolesTtlMs };
    return data;
  }

  /** Drop the memoized roles list; the next resolution reloads from the DB. */
  invalidateRolesCache(): void {
    this.rolesCache = undefined;
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
    const allRoles = await this.listRolesCached();
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
      // Resolve role → actions ONCE from the memoized roles list instead of one
      // getActionsByNames() query per grant (the previous N+1).
      const actionsByRole = new Map<string, string[]>();
      for (const r of await this.listRolesCached()) actionsByRole.set(r.name, r.actions || []);
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
        const actions = roleNames.flatMap((rn) => actionsByRole.get(rn) || []);
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
