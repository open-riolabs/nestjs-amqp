import { Inject, Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ForbiddenError, PaginationModel } from '../../../common';
import { BrokerAction, BrokerParam } from '../../broker';
import { grantMatchesResource } from '../auth-match';
import { AclCacheService } from '../cache/acl-cache.service';
import { AclModuleOptions } from '../config/acl.config';
import { ACL_ACTIONS, ACL_DEFAULT_ROLE_MANAGEMENT_ACTION, ACL_DEFAULT_ROLE_SYSTEM_ACTION, ACL_TOPIC, RLB_ACL_OPTIONS } from '../const';
import { AclAction, AclGrant, AclRole } from '../models';
import { AclActionRepository } from '../repository/acl-action.repository';
import { AclGrantRepository } from '../repository/acl-grant.repository';
import { AclRoleRepository } from '../repository/acl-role.repository';
import { AclInvalidationService } from './acl-invalidation.service';
import { AclService } from './acl.service';

@Injectable()
export class AclManagementService {
  private readonly logger = new Logger(AclManagementService.name);
  /** Action the caller must hold (on the target company/resource) to grant or revoke. */
  private readonly roleMgmtAction: string;
  /** SYSTEM-level override action: held resource-agnostically, it bypasses the per-resource check. */
  private readonly roleSystemAction: string;

  constructor(
    private readonly actions: AclActionRepository,
    private readonly roles: AclRoleRepository,
    private readonly grants: AclGrantRepository,
    private readonly cache: AclCacheService,
    private readonly acl: AclService,
    private readonly invalidation: AclInvalidationService,
    @Inject(RLB_ACL_OPTIONS) options: AclModuleOptions,
  ) {
    this.roleMgmtAction = options.roleManagementAction ?? ACL_DEFAULT_ROLE_MANAGEMENT_ACTION;
    this.roleSystemAction = options.roleSystemAction ?? ACL_DEFAULT_ROLE_SYSTEM_ACTION;
  }

  /**
   * Authorize a grant/revoke by `currentUser` on the target (companyId, resourceId).
   * Two ways to pass:
   *   1. the SYSTEM override `roleSystemAction`, held resource-AGNOSTICALLY (ctx undefined) — a
   *      trusted system admin may act on ANY resource, including a brand-new one with no grants yet;
   *   2. the per-resource `roleMgmtAction`, held on the EXACT target (companyId, resourceId).
   * Throws ForbiddenError when neither holds. The per-resource check runs first so a normal manager
   * costs a single (cached) lookup; the system override is only evaluated when it fails.
   */
  private async assertCanManage(currentUser: string, companyId: string | undefined, resourceId: string | undefined, verb: 'grant' | 'revoke'): Promise<void> {
    if (await this.acl.checkAction(currentUser, { companyId, resourceId }, this.roleMgmtAction)) return;
    if (await this.acl.checkAction(currentUser, undefined, this.roleSystemAction)) return;
    throw new ForbiddenError(`'${this.roleMgmtAction}' on the target resource, or the system-level '${this.roleSystemAction}', is required to ${verb}`);
  }

  /**
   * Invalidate one user's cached decisions locally + L2, then broadcast so peer instances flush
   * their RAM too. Used by grant/revoke (a single user's grants changed).
   */
  private async invalidateUser(userId: string): Promise<void> {
    await this.cache.invalidate(userId);
    await this.invalidation.broadcast('user', userId);
  }

  /**
   * Invalidate ALL cached decisions locally + L2 and drop the roles memo, then broadcast the same
   * to peers. Used by role/action mutations, which can affect every user's decisions.
   */
  private async invalidateAll(): Promise<void> {
    await this.cache.invalidate();
    this.acl.invalidateRolesCache();
    await this.invalidation.broadcast('all');
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
    await this.assertCanManage(currentUser ?? '', companyId, resourceId, 'grant');
    return this.applyGrant(userId, roles, resourceId, companyId, friendlyName);
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.revoke, 'rpc')
  async revoke(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'roles') roles: string[],
    @BrokerParam('body', 'resourceId') resourceId?: string,
    @BrokerParam('body', 'companyId') companyId?: string,
    @BrokerParam('header', 'X-GTW-AUTH-USERID') currentUser?: string,
  ): Promise<AclGrant | null> {
    await this.assertCanManage(currentUser ?? '', companyId, resourceId, 'revoke');
    return this.applyRevoke(userId, roles, resourceId, companyId);
  }

  // Admin (trusted service-to-service) variants: identical write to grant/revoke but WITHOUT the
  // caller-authorization check. AMQP-only (no @BrokerHTTP → never reachable through the gateway):
  // an internal service — e.g. self-registration bootstrapping the creator's first owner role on a
  // brand-new company — is trusted to act without holding role-management/role-system itself.
  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.adminGrant, 'rpc')
  async adminGrant(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'roles') roles: string[],
    @BrokerParam('body', 'resourceId') resourceId?: string,
    @BrokerParam('body', 'companyId') companyId?: string,
    @BrokerParam('body', 'friendlyName') friendlyName?: string,
  ): Promise<AclGrant> {
    return this.applyGrant(userId, roles, resourceId, companyId, friendlyName);
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.adminRevoke, 'rpc')
  async adminRevoke(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'roles') roles: string[],
    @BrokerParam('body', 'resourceId') resourceId?: string,
    @BrokerParam('body', 'companyId') companyId?: string,
  ): Promise<AclGrant | null> {
    return this.applyRevoke(userId, roles, resourceId, companyId);
  }

  /**
   * Grant write logic shared by {@link grant} (gated) and {@link adminGrant} (trusted, ungated):
   * validates the roles exist, then creates or MERGES into the single (userId, companyId, resourceId)
   * record. Idempotent — re-granting the same roles never produces a duplicate doc.
   */
  private async applyGrant(userId: string, roles: string[], resourceId?: string, companyId?: string, friendlyName?: string): Promise<AclGrant> {
    if (!userId) throw new BadRequestError('userId is required');
    if (!roles?.length) throw new BadRequestError('roles are required');
    await this.assertRolesExist(roles);
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
    await this.invalidateUser(userId);
    return result;
  }

  /**
   * Revoke write logic shared by {@link revoke} (gated) and {@link adminRevoke} (trusted, ungated):
   * removes the given roles from the (userId, companyId, resourceId) grant; keeps the record while any
   * role remains, deletes it once empty. Returns null when there is no such grant.
   */
  private async applyRevoke(userId: string, roles: string[], resourceId?: string, companyId?: string): Promise<AclGrant | null> {
    if (!userId) throw new BadRequestError('userId is required');
    if (!roles?.length) throw new BadRequestError('roles are required');
    const existing = await this.findGrant(userId, companyId, resourceId);
    if (!existing) return null;
    const remaining = (existing.roles || []).filter((r) => !roles.includes(r));
    const result = remaining.length
      ? await this.grants.updateById(existing._id!, { roles: remaining })
      : await this.grants.removeById(existing._id!);
    await this.invalidateUser(userId);
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
    await this.invalidateAll();
    return result;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.actionDelete, 'rpc')
  async deleteAction(@BrokerParam('body', 'name') name: string): Promise<AclAction> {
    if (!name) throw new BadRequestError('name is required');
    const removed = await this.actions.removeOne({ name });
    await this.invalidateAll();
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
    await this.invalidateAll();
    return result;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.roleDelete, 'rpc')
  async deleteRole(@BrokerParam('body', 'name') name: string): Promise<AclRole> {
    // Guard a missing name: removeOne({ name: undefined }) would match an arbitrary role
    // (the filter value is ignored) and silently delete it. Fail with 400 instead.
    if (!name) throw new BadRequestError('name is required');
    const removed = await this.roles.removeOne({ name });
    await this.invalidateAll();
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
