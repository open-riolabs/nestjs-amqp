import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, PaginationModel } from '../../../common';
import { BrokerAction, BrokerParam } from '../../broker';
import { AclCacheService } from '../cache/acl-cache.service';
import { ACL_ACTIONS, ACL_TOPIC } from '../const';
import { AclAction, AclGrant, AclRole } from '../models';
import { AclActionRepository } from '../repository/acl-action.repository';
import { AclGrantRepository } from '../repository/acl-grant.repository';
import { AclRoleRepository } from '../repository/acl-role.repository';

@Injectable()
export class AclManagementService {
  private readonly logger = new Logger(AclManagementService.name);

  constructor(
    private readonly actions: AclActionRepository,
    private readonly roles: AclRoleRepository,
    private readonly grants: AclGrantRepository,
    private readonly cache: AclCacheService,
  ) { }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.grant, 'rpc')
  async grant(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'roles') roles: string[],
    @BrokerParam('body', 'resourceId') resourceId?: string,
    @BrokerParam('body', 'resourceBusinessId') resourceBusinessId?: string,
    @BrokerParam('body', 'friendlyName') friendlyName?: string,
  ): Promise<AclGrant> {
    if (!userId) throw new BadRequestError('userId is required');
    if (!roles?.length) throw new BadRequestError('roles are required');
    await this.assertRolesExist(roles);
    const grant = await this.grants.insert({ userId, roles, resourceId, resourceBusinessId: resourceBusinessId, friendlyName });
    await this.cache.invalidate(userId);
    return grant;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.revoke, 'rpc')
  async revoke(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('body', 'resourceId') resourceId?: string,
  ): Promise<AclGrant> {
    if (!userId) throw new BadRequestError('userId is required');
    const removed = await this.grants.removeOne({ userId, ...(resourceId !== undefined ? { resourceId } : {}) });
    await this.cache.invalidate(userId);
    return removed;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.actionCreate, 'rpc')
  async createAction(
    @BrokerParam('body', 'name') name: string,
    @BrokerParam('body', 'description') description?: string,
  ): Promise<AclAction> {
    if (!name) throw new BadRequestError('name is required');
    const created = await this.actions.insert({ name, description });
    await this.cache.invalidate();
    return created;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.actionUpdate, 'rpc')
  async updateAction(
    @BrokerParam('body', 'id') id: string,
    @BrokerParam('body-full') model: Partial<AclAction>,
  ): Promise<AclAction> {
    if (!id) throw new BadRequestError('id is required');
    const updated = await this.actions.updateById(id, model);
    await this.cache.invalidate();
    return updated;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.actionDelete, 'rpc')
  async deleteAction(@BrokerParam('body', 'id') id: string): Promise<AclAction> {
    const removed = await this.actions.removeById(id);
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

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.roleCreate, 'rpc')
  async createRole(
    @BrokerParam('body', 'name') name: string,
    @BrokerParam('body', 'actions') actions: string[],
    @BrokerParam('body', 'description') description?: string,
  ): Promise<AclRole> {
    if (!name) throw new BadRequestError('name is required');
    if (!actions?.length) throw new BadRequestError('actions are required');
    await this.assertActionsExist(actions);
    const created = await this.roles.insert({ name, description, actions });
    await this.cache.invalidate();
    return created;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.roleUpdate, 'rpc')
  async updateRole(
    @BrokerParam('body', 'name') name: string,
    @BrokerParam('body-full') model: Partial<AclRole>,
  ): Promise<AclRole> {
    if (!name) throw new BadRequestError('name is required');
    if (model?.actions?.length) await this.assertActionsExist(model.actions);
    const updated = await this.roles.updateOne({ name }, model);
    await this.cache.invalidate();
    return updated;
  }

  @BrokerAction(ACL_TOPIC, ACL_ACTIONS.roleDelete, 'rpc')
  async deleteRole(@BrokerParam('body', 'name') name: string): Promise<AclRole> {
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
    return this.roles.findOne({ name });
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
