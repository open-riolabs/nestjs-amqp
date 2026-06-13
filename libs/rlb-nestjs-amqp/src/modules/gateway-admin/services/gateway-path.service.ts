import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, PaginationModel } from '../../../common';
import { BrokerAction, BrokerParam } from '../../broker';
import { PathDefinition } from '../../proxy/config/path-definition.config';
import { GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS } from '../const';
import { HttpPathRepository, StoredHttpPath } from '../repository/http-path.repository';
import { orderPaths } from '../util/path-order';

@Injectable()
export class GatewayPathService {
  private readonly logger = new Logger(GatewayPathService.name);

  constructor(private readonly repo: HttpPathRepository) { }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathCreate, 'rpc')
  async create(@BrokerParam('body-full') model: StoredHttpPath): Promise<StoredHttpPath> {
    if (!model?.name) throw new BadRequestError('name is required');
    if (!model?.method) throw new BadRequestError('method is required');
    if (!model?.path) throw new BadRequestError('path is required');
    if (!model?.topic) throw new BadRequestError('topic is required');
    return this.repo.insert(model);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathUpdate, 'rpc')
  async update(@BrokerParam('body', 'id') id: string, @BrokerParam('body-full') model: StoredHttpPath): Promise<StoredHttpPath> {
    if (!id) throw new BadRequestError('id is required');
    return this.repo.updateById(id, model);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathDelete, 'rpc')
  async remove(@BrokerParam('body', 'id') id: string): Promise<StoredHttpPath> {
    return this.repo.removeById(id);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathGet, 'rpc')
  async get(@BrokerParam('body', 'id') id: string): Promise<StoredHttpPath> {
    return this.repo.findById(id);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathList, 'rpc')
  async list(@BrokerParam('body', 'page') page?: number, @BrokerParam('body', 'limit') limit?: number): Promise<PaginationModel<StoredHttpPath>> {
    return this.repo.filterPaginated({}, Number(page) || 1, Number(limit) || 10);
  }

  /** Responder for gateway.loadConfig.paths — all enabled paths, ordered static-before-param. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathExport, 'rpc')
  async export(): Promise<PathDefinition[]> {
    const paths = await this.repo.listEnabled();
    return orderPaths(paths);
  }
}
