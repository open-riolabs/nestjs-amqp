import { Injectable, Logger } from '@nestjs/common';
import { UnauthorizedError } from '../../../common';
import { BrokerAction, BrokerParam } from '../../broker';
import { IAclRoleService } from '../../proxy/services/acl.service';
import { AclCacheService } from '../cache/acl-cache.service';
import { ACL_ACTIONS, ACL_TOPIC } from '../const';
import { AclGrant, AclResourceGroup } from '../models';
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

  private toList(roles: string | string[]): string[] {
    return Array.isArray(roles) ? roles : (roles ? [roles] : []);
  }

  async canUserDoGtw(roles: string | string[], userId: string): Promise<boolean> {
    const list = this.toList(roles);
    if (!userId || !list.length) return false;
    const cacheAction = `role-gtw:${[...list].sort().join(',')}`;
    const cached = await this.cache.get(userId, cacheAction);
    if (cached !== null) return cached;
    const grants = await this.grants.filter({ userId });
    const allowed = grants.some((g) => (g.roles || []).some((r) => list.includes(r)));
    await this.cache.set(userId, cacheAction, allowed);
    return allowed;
  }

  async canUserDo(roles: string | string[], userId: string, resourceId?: string): Promise<boolean> {
    const list = this.toList(roles);
    if (!userId || !list.length) return false;
    const cacheAction = `role-res:${resourceId ?? '*'}:${[...list].sort().join(',')}`;
    const cached = await this.cache.get(userId, cacheAction);
    if (cached !== null) return cached;
    const grants = await this.grants.filter({ userId });
    const scoped = grants.filter((g) => g.resourceId == null || g.resourceId === resourceId);
    const allowed = scoped.some((g) => (g.roles || []).some((r) => list.includes(r)));
    await this.cache.set(userId, cacheAction, allowed);
    return allowed;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.canUserDoGtw, 'rpc')
  async handleCanUserDoGtw(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'roles') roles?: string | string[],
  ): Promise<boolean> {
    try {
      return await this.canUserDoGtw(roles ?? [], userId);
    } catch (error) {
      this.logger.error(error);
      return false;
    }
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.canUserDo, 'rpc')
  async handleCanUserDo(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'resource') resource: string,
    @BrokerParam('body', 'roles') roles?: string | string[],
  ): Promise<boolean> {
    try {
      return await this.canUserDo(roles ?? [], userId, resource);
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
        const businessId = item.resourceBusinessId ?? '';
        if (!grouped[businessId]) {
          grouped[businessId] = { resourceBusinessId: item.resourceBusinessId, resources: [] };
        }
        let resource = grouped[businessId].resources.find((r) => r.resourceId === item.resourceId);
        if (!resource) {
          resource = { resourceId: item.resourceId, actions: [], friendlyName: item.friendlyName };
          grouped[businessId].resources.push(resource);
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

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.listByUser, 'rpc')
  async listByUser(@BrokerParam('body', 'userId') userId: string): Promise<AclGrant[]> {
    try {
      return await this.grants.filter({ userId });
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.verifyAccess, 'rpc')
  async verifyAccess(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'resourceId') resourceId: string,
    @BrokerParam('body', 'action') action: string,
    @BrokerParam('body', 'resourceBusinessId') resourceBusinessId?: string,
    @BrokerParam('body', 'productId') productId?: string,
  ): Promise<boolean> {
    try {
      const businessId = resourceBusinessId ?? productId;
      const filter = {
        userId,
        resourceId,
        ...(businessId !== undefined ? { resourceBusinessId: businessId } : {}),
      };
      return await this.grants.checkActions(filter, action);
    } catch (error) {
      this.logger.error(error);
      throw error;
    }
  }
}
