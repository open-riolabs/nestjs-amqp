import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ConflictError, PaginationModel } from '../../../common';
import { BrokerAction, BrokerParam } from '../../broker';
import { PathDefinition } from '../../proxy/config/path-definition.config';
import { GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS } from '../const';
import { HttpPathRepository, StoredHttpPath } from '../repository/http-path.repository';
import { orderPaths } from '../util/path-order';
import { routeKeyOf } from '../util/route-manifest';

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
    const routeKey = routeKeyOf(model);
    await this.assertNoRouteConflict(routeKey);
    return this.repo.insert({ ...model, routeKey });
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathUpdate, 'rpc')
  async update(@BrokerParam('body', 'id') id: string, @BrokerParam('body-full') model: StoredHttpPath): Promise<StoredHttpPath> {
    if (!id) throw new BadRequestError('id is required');
    // If the update changes the route identity (method+path), re-check it does not collide
    // with another existing route, and keep the routeKey in sync.
    if (model?.method && model?.path) {
      const routeKey = routeKeyOf(model);
      await this.assertNoRouteConflict(routeKey, id);
      model = { ...model, routeKey };
    }
    return this.repo.updateById(id, model);
  }

  /**
   * Rejects creating/updating a route whose identity `(method, path)` already belongs to ANOTHER
   * enabled route (manual or discovered). Two routes with the same method+path cannot both be
   * registered on Express, so we fail fast with a 409 instead of producing a silent shadow.
   */
  private async assertNoRouteConflict(routeKey: string, excludeId?: string): Promise<void> {
    const clashes = await this.repo.findByRouteKey(routeKey);
    const conflict = (clashes || []).find((p) => p.enabled !== false && p._id !== excludeId);
    if (conflict) {
      throw new ConflictError(`A route '${routeKey}' already exists (owner '${conflict.owner ?? 'manual'}', id ${conflict._id}).`);
    }
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
