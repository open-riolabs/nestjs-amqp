import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ConflictError, PaginationModel } from '../../../common';
import { HandlerAuthConfig } from '../../broker/config/handler-auth.config';
import { BrokerAction, BrokerParam } from '../../broker';
import { GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS } from '../const';
import { AuthProviderRepository, StoredAuthProvider } from '../repository/auth-provider.repository';
import { HttpPathRepository, StoredHttpPath } from '../repository/http-path.repository';

@Injectable()
export class GatewayAuthService {
  private readonly logger = new Logger(GatewayAuthService.name);

  constructor(
    private readonly repo: AuthProviderRepository,
    private readonly paths: HttpPathRepository,
  ) { }

  // PUT = create-or-update, keyed by `name` (auth-providers have no id). There is no POST.
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authUpdate, 'rpc')
  async upsert(@BrokerParam('body', 'name') name: string, @BrokerParam('body-full') model: StoredAuthProvider): Promise<StoredAuthProvider> {
    if (!name) throw new BadRequestError('name is required');
    if (!model?.type) throw new BadRequestError('type is required');
    return this.repo.upsertByName(name, model);
  }

  /**
   * Delete a provider. BLOCKED with 409 ConflictError when DB routes still reference it (`auth ===
   * name`) — the conflicting routes are returned in the error `details.routes`. `force: true` first
   * clears `auth` on those routes, then deletes the provider.
   */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authDelete, 'rpc')
  async remove(
    @BrokerParam('body', 'name') name: string,
    @BrokerParam('body', 'force') force?: boolean | string,
  ): Promise<StoredAuthProvider> {
    if (!name) throw new BadRequestError('name is required');
    const routes = await this.paths.filter({ auth: name });
    if (routes.length) {
      if (force !== true && force !== 'true') {
        throw new ConflictError(
          `Auth provider '${name}' is referenced by ${routes.length} route(s); pass force=true to delete it and clear 'auth' on them.`,
          { routes: routes.map((r) => ({ routeKey: r.routeKey, method: r.method, path: r.path, name: r.name })) },
        );
      }
      // force: clear `auth` on each referencing route, then delete the provider.
      for (const r of routes) {
        if (r._id) await this.paths.updateById(r._id, { auth: null } as unknown as StoredHttpPath);
      }
    }
    return this.repo.removeByName(name);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authGet, 'rpc')
  async get(@BrokerParam('body', 'name') name: string): Promise<StoredAuthProvider> {
    if (!name) throw new BadRequestError('name is required');
    return this.repo.findByName(name);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authList, 'rpc')
  async list(@BrokerParam('body', 'page') page?: number, @BrokerParam('body', 'limit') limit?: number): Promise<PaginationModel<StoredAuthProvider>> {
    return this.repo.filterPaginated({}, Number(page) || 1, Number(limit) || 10);
  }

  /** Free-text search over stored auth-providers → PaginationModel<StoredAuthProvider> (delegated). */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authSearch, 'rpc')
  async search(@BrokerParam('body', 'q') q?: string, @BrokerParam('body', 'page') page?: number, @BrokerParam('body', 'limit') limit?: number): Promise<PaginationModel<StoredAuthProvider>> {
    return this.repo.search(q, Number(page) || 1, Number(limit) || 10);
  }

  /** Exposes all enabled auth-providers (to be read in addition to YAML / for the frontend). */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.authExport, 'rpc')
  async export(): Promise<HandlerAuthConfig[]> {
    return this.repo.listEnabled();
  }
}
