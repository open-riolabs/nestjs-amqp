import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, PaginationModel } from '../../../common';
import { HandlerAuthConfig } from '../../broker/config/handler-auth.config';
import { BrokerAction, BrokerParam } from '../../broker';
import { GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS } from '../const';
import { AuthProviderRepository, StoredAuthProvider } from '../repository/auth-provider.repository';

@Injectable()
export class GatewayAuthService {
  private readonly logger = new Logger(GatewayAuthService.name);

  constructor(private readonly repo: AuthProviderRepository) { }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authCreate, 'rpc')
  async create(@BrokerParam('body-full') model: StoredAuthProvider): Promise<StoredAuthProvider> {
    if (!model?.name) throw new BadRequestError('name is required');
    if (!model?.type) throw new BadRequestError('type is required');
    return this.repo.insert(model);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authUpdate, 'rpc')
  async update(@BrokerParam('body', 'id') id: string, @BrokerParam('body-full') model: StoredAuthProvider): Promise<StoredAuthProvider> {
    if (!id) throw new BadRequestError('id is required');
    return this.repo.updateById(id, model);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authDelete, 'rpc')
  async remove(@BrokerParam('body', 'id') id: string): Promise<StoredAuthProvider> {
    return this.repo.removeById(id);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authGet, 'rpc')
  async get(@BrokerParam('body', 'id') id: string): Promise<StoredAuthProvider> {
    return this.repo.findById(id);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authList, 'rpc')
  async list(@BrokerParam('body', 'page') page?: number, @BrokerParam('body', 'limit') limit?: number): Promise<PaginationModel<StoredAuthProvider>> {
    return this.repo.filterPaginated({}, Number(page) || 1, Number(limit) || 10);
  }

  /** Exposes all enabled auth-providers (to be read in addition to YAML / for the frontend). */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authExport, 'rpc')
  async export(): Promise<HandlerAuthConfig[]> {
    return this.repo.listEnabled();
  }
}
