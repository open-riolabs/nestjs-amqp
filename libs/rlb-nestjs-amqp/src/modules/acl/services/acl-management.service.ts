import { Inject, Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ForbiddenError, PaginationModel } from '../../../common';
import { BrokerAction, BrokerParam } from '../../broker';
import { grantMatchesResource } from '../auth-match';
import { AclCacheService } from '../cache/acl-cache.service';
import { AclModuleOptions } from '../config/acl.config';
import { ACL_ACTIONS, ACL_DEFAULT_ROLE_MANAGEMENT_ACTION, ACL_TOPIC, RLB_ACL_OPTIONS } from '../const';
import { AclAction, AclGrant, AclRole } from '../models';
import { AclActionRepository } from '../repository/acl-action.repository';
import { AclGrantRepository } from '../repository/acl-grant.repository';
import { AclRoleRepository } from '../repository/acl-role.repository';
import { AclService } from './acl.service';

@Injectable()
export class AclManagementService {
  private readonly logger = new Logger(AclManagementService.name);
  /** Action the caller must hold (on the target company/resource) to grant or revoke. */
  private readonly roleMgmtAction: string;

  constructor(
    private readonly actions: AclActionRepository,
    private readonly roles: AclRoleRepository,
    private readonly grants: AclGrantRepository,
    private readonly cache: AclCacheService,
    private readonly acl: AclService,
    @Inject(RLB_ACL_OPTIONS) options: AclModuleOptions,
  ) {
    this.roleMgmtAction = options.roleManagementAction ?? ACL_DEFAULT_ROLE_MANAGEMENT_ACTION;
  }

  // grant/revoke are DUAL ops on the single (userId, companyId, resourceId) record: grant ADDS roles
  // (creating it if absent), revoke REMOVES them (deleting it once empty). Both are GATED — the
  // caller (X-GTW-AUTH-USERID) must hold the role-management action on the target (companyId,
  // resourceId). Seed the first role-management grant in the DB out-of-band to bootstrap.
  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.grant, 'rpc')
  async grant(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'roles') roles: string[],
    @BrokerParam('body', 'resourceId') resourceId?: string,
    @BrokerParam('body', 'companyId') companyId?: string,
    @BrokerParam('body', 'friendlyName') friendlyName?: string,
    @BrokerParam('header', 'X-GTW-AUTH-USERID') currentUser?: string,
  ): Promise<AclGrant> {
    if (!userId) throw new BadRequestError('userId is required');
    if (!roles?.length) throw new BadRequestError('roles are required');
    if (!(await this.acl.checkAction(currentUser ?? '', { companyId, resourceId }, this.roleMgmtAction))) {
      throw new ForbiddenError(`'${this.roleMgmtAction}' is required on the target resource to grant`);
    }
    await this.assertRolesExist(roles);
    // ONE grant per (userId, companyId, resourceId): create it if absent, otherwise MERGE the roles
    // into the existing one. Idempotent — re-granting the same roles never produces a duplicate doc.
    const existing = await this.findGrant(userId, companyId, resourceId);
    let result: AclGrant;
    if (existing) {
      const merged = Array.from(new Set([...(existing.roles || []), ...roles]));
      result = await this.grants.updateById(existing._id!, {
        roles: merged,
        companyId: companyId ?? existing.companyId,
        friendlyName: friendlyName ?? existing.friendlyName,
      });
    } else {
      result = await this.grants.insert({ userId, roles: Array.from(new Set(roles)), resourceId, companyId, friendlyName });
    }
    await this.cache.invalidate(userId);
    return result;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.revoke, 'rpc')
  async revoke(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'roles') roles: string[],
    @BrokerParam('body', 'resourceId') resourceId?: string,
    @BrokerParam('body', 'companyId') companyId?: string,
    @BrokerParam('header', 'X-GTW-AUTH-USERID') currentUser?: string,
  ): Promise<AclGrant | null> {
    if (!userId) throw new BadRequestError('userId is required');
    if (!roles?.length) throw new BadRequestError('roles are required');
    if (!(await this.acl.checkAction(currentUser ?? '', { companyId, resourceId }, this.roleMgmtAction))) {
      throw new ForbiddenError(`'${this.roleMgmtAction}' is required on the target resource to revoke`);
    }
    const existing = await this.findGrant(userId, companyId, resourceId);
    if (!existing) return null;
    // Remove the given roles from the (userId, companyId, resourceId) grant; keep the record while
    // any role remains, delete it once empty.
    const remaining = (existing.roles || []).filter((r) => !roles.includes(r));
    const result = remaining.length
      ? await this.grants.updateById(existing._id!, { roles: remaining })
      : await this.grants.removeById(existing._id!);
    await this.cache.invalidate(userId);
    return result;
  }

  /** The single grant for (userId, companyId, resourceId), matched exactly (absent ids compare equal). */
  private async findGrant(userId: string, companyId?: string, resourceId?: string): Promise<AclGrant | undefined> {
    const all = await this.grants.filter({ userId });
    return (all || []).find((g) => grantMatchesResource(g, { companyId, resourceId }));
  }

  // PUT = create-or-update, keyed by `name` (actions have no separate id — the name IS the key).
  // Idempotent: PUTting the same action twice updates it in place rather than creating a duplicate.
  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.actionUpdate, 'rpc')
  async upsertAction(
    @BrokerParam('body', 'name') name: string,
    @BrokerParam('body', 'description') description?: string,
  ): Promise<AclAction> {
    if (!name) throw new BadRequestError('name is required');
    const model: Partial<AclAction> = { name, ...(description !== undefined ? { description } : {}) };
    const result = await this.actions.upsertOne({ name }, model);
    await this.cache.invalidate();
    return result;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.actionDelete, 'rpc')
  async deleteAction(@BrokerParam('body', 'name') name: string): Promise<AclAction> {
    if (!name) throw new BadRequestError('name is required');
    const removed = await this.actions.removeOne({ name });
    await this.cache.invalidate();
    return removed;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.actionList, 'rpc')
  async listActions(
    @BrokerParam('body', 'page') page?: number,
    @BrokerParam('body', 'limit') limit?: number,
  ): Promise<PaginationModel<AclAction>> {
    return this.actions.filterPaginated({}, Number(page) || 1, Number(limit) || 10);
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.actionGet, 'rpc')
  async getAction(@BrokerParam('body', 'name') name: string): Promise<AclAction> {
    if (!name) throw new BadRequestError('name is required');
    return this.actions.findByName(name);
  }

  // PUT = create-or-update, keyed by `name` (roles have no separate id — the name IS the key). A
  // role is fully described by name + actions, so PUT replaces them; idempotent on repeat.
  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.roleUpdate, 'rpc')
  async upsertRole(
    @BrokerParam('body', 'name') name: string,
    @BrokerParam('body', 'actions') actions: string[],
    @BrokerParam('body', 'description') description?: string,
  ): Promise<AclRole> {
    if (!name) throw new BadRequestError('name is required');
    if (!actions?.length) throw new BadRequestError('actions are required');
    await this.assertActionsExist(actions);
    const model: Partial<AclRole> = { name, actions, ...(description !== undefined ? { description } : {}) };
    const result = await this.roles.upsertOne({ name }, model);
    await this.cache.invalidate();
    return result;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.roleDelete, 'rpc')
  async deleteRole(@BrokerParam('body', 'name') name: string): Promise<AclRole> {
    // Guard a missing name: removeOne({ name: undefined }) would match an arbitrary role
    // (the filter value is ignored) and silently delete it. Fail with 400 instead.
    if (!name) throw new BadRequestError('name is required');
    const removed = await this.roles.removeOne({ name });
    await this.cache.invalidate();
    return removed;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.roleList, 'rpc')
  async listRoles(
    @BrokerParam('body', 'page') page?: number,
    @BrokerParam('body', 'limit') limit?: number,
  ): Promise<PaginationModel<AclRole>> {
    return this.roles.filterPaginated({}, Number(page) || 1, Number(limit) || 10);
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.roleGet, 'rpc')
  async getRole(@BrokerParam('body', 'name') name: string): Promise<AclRole> {
    if (!name) throw new BadRequestError('name is required');
    return this.roles.findByName(name);
  }

  /** Free-text search over actions → PaginationModel<AclAction> (delegated to the repository's query). */
  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.actionSearch, 'rpc')
  async searchActions(@BrokerParam('body', 'q') q?: string, @BrokerParam('body', 'page') page?: number, @BrokerParam('body', 'limit') limit?: number): Promise<PaginationModel<AclAction>> {
    return this.actions.search(q, Number(page) || 1, Number(limit) || 10);
  }

  /** Free-text search over roles → PaginationModel<AclRole> (delegated to the repository's query). */
  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.roleSearch, 'rpc')
  async searchRoles(@BrokerParam('body', 'q') q?: string, @BrokerParam('body', 'page') page?: number, @BrokerParam('body', 'limit') limit?: number): Promise<PaginationModel<AclRole>> {
    return this.roles.search(q, Number(page) || 1, Number(limit) || 10);
  }

  /** Free-text search over grants (access) → PaginationModel<AclGrant> (delegated to the repository). */
  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.grantSearch, 'rpc')
  async searchGrants(@BrokerParam('body', 'q') q?: string, @BrokerParam('body', 'page') page?: number, @BrokerParam('body', 'limit') limit?: number): Promise<PaginationModel<AclGrant>> {
    return this.grants.search(q, Number(page) || 1, Number(limit) || 10);
  }

  async getActionsByNames(names: string[]): Promise<string[]> {
    return this.roles.getActionsByNames(names);
  }

  private async assertActionsExist(names: string[]): Promise<void> {
    const found = await this.actions.filter({ name: { $in: names } });
    const missing = names.filter((n) => !found.some((a) => a.name === n));
    if (missing.length) throw new BadRequestError(`Unknown actions: ${missing.join(', ')}`);
  }

  private async assertRolesExist(names: string[]): Promise<void> {
    const found = await this.roles.filter({ name: { $in: names } });
    const missing = names.filter((n) => !found.some((r) => r.name === n));
    if (missing.length) throw new BadRequestError(`Unknown roles: ${missing.join(', ')}`);
  }
}
