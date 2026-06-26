import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError, ConflictError, PaginationModel } from '../../../common';
import { BrokerAction, BrokerParam } from '../../broker';
import { PathDefinition } from '../../proxy/config/path-definition.config';
import { GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS } from '../const';
import { RouteSyncLogEntry } from '../models';
import { HttpPathRepository, StoredHttpPath } from '../repository/http-path.repository';
import { RouteSyncLogRepository } from '../repository/route-sync-log.repository';
import { orderPaths } from '../util/path-order';
import { diffRouteFields, renderChanges, routeKeyOf, USER_OVERRIDABLE_FIELDS } from '../util/route-manifest';

@Injectable()
export class GatewayPathService {
  private readonly logger = new Logger(GatewayPathService.name);

  constructor(
    private readonly repo: HttpPathRepository,
    private readonly logs: RouteSyncLogRepository,
  ) { }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathCreate, 'rpc')
  async create(
    @BrokerParam('body-full') model: StoredHttpPath,
    @BrokerParam('header', 'X-GTW-AUTH-USERID') currentUser?: string,
  ): Promise<StoredHttpPath> {
    if (!model?.name) throw new BadRequestError('name is required');
    if (!model?.method) throw new BadRequestError('method is required');
    if (!model?.path) throw new BadRequestError('path is required');
    if (!model?.topic) throw new BadRequestError('topic is required');
    const routeKey = routeKeyOf(model);
    await this.assertNoRouteConflict(routeKey);
    // A user-created route is owned by the user (source='user'); route auto-discovery never manages
    // it. `source` is forced here regardless of the payload.
    const created = await this.repo.insert({ ...model, routeKey, source: 'user', modified: false });
    const actor = currentUser ?? 'unknown';
    await this.journal({ service: created.owner ?? 'manual', actor, level: 'info', event: 'created', routeKey, method: created.method, path: created.path, topic: created.topic, action: created.action });
    this.logger.log(`[gw-path] ${actor} created '${routeKey}'`);
    return created;
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathUpdate, 'rpc')
  async update(
    @BrokerParam('body-full') body: StoredHttpPath & { id?: string; releaseOverrides?: string[] | string },
    @BrokerParam('header', 'X-GTW-AUTH-USERID') currentUser?: string,
  ): Promise<StoredHttpPath> {
    // Pull control-only keys out of the persisted model: `id`/`_id` (identity, never columns) and
    // `releaseOverrides` (a directive to hand soft fields back to the MS, not route data).
    const { id, _id, releaseOverrides, ...rest } = (body || {}) as any;
    if (!id) throw new BadRequestError('id is required');
    let model: StoredHttpPath = rest;
    const existing = await this.repo.findById(id);
    // If the update changes the route identity (method+path), re-check it does not collide
    // with another existing route, and keep the routeKey in sync.
    if (model?.method && model?.path) {
      const routeKey = routeKeyOf(model);
      await this.assertNoRouteConflict(routeKey, id);
      model = { ...model, routeKey };
    }
    // Diff the effective new state (existing merged with the partial body) so fields the user did
    // NOT send are not reported as removed. `enabled` is a persistence field (not in diffRouteFields),
    // so detect its flip separately and fold it into the change set for both auditing and classifying.
    const contentChanges = existing ? diffRouteFields(existing, { ...existing, ...model }) : [];
    const enabledChanged = !!existing && model?.enabled !== undefined && (model.enabled !== false) !== (existing.enabled !== false);
    const changes = enabledChanged
      ? [...contentChanges, { field: 'enabled', added: [model.enabled !== false], removed: [existing!.enabled !== false] }]
      : contentChanges;

    // Classify the changed fields: a HARD field (anything not in USER_OVERRIDABLE_FIELDS) locks the
    // whole route (modified=true → route auto-discovery skips it); SOFT-only edits do NOT lock — the
    // MS keeps managing the other fields, and these fields' user values are PRESERVED (userOverrides).
    const changedFields = changes.map((c) => c.field);
    const changedHard = changedFields.filter((f) => !USER_OVERRIDABLE_FIELDS.includes(f));
    const changedSoft = changedFields.filter((f) => USER_OVERRIDABLE_FIELDS.includes(f));
    const released = Array.isArray(releaseOverrides) ? releaseOverrides : releaseOverrides ? [releaseOverrides] : [];
    const overrides = new Set<string>([...(existing?.userOverrides || []), ...changedSoft]);
    for (const f of released) overrides.delete(f); // reset a single override → MS resumes that field
    const userOverrides = [...overrides];
    const modified = changedHard.length > 0 ? true : !!existing?.modified;

    const updated = await this.repo.updateById(id, { ...model, modified, userOverrides });
    const actor = currentUser ?? 'unknown';
    const rendered = renderChanges(changes);
    await this.journal({ service: updated?.owner ?? existing?.owner ?? 'manual', actor, level: 'info', event: 'updated', routeKey: updated?.routeKey ?? existing?.routeKey, method: updated?.method ?? existing?.method, path: updated?.path ?? existing?.path, changes, message: rendered });
    this.logger.log(`[gw-path] ${actor} updated '${updated?.routeKey ?? existing?.routeKey}'${modified ? ' [locked]' : userOverrides.length ? ` [overrides: ${userOverrides.join(',')}]` : ''}${rendered ? ` → ${rendered}` : ''}`);
    return updated;
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
  async remove(
    @BrokerParam('body', 'id') id: string,
    @BrokerParam('header', 'X-GTW-AUTH-USERID') currentUser?: string,
  ): Promise<StoredHttpPath> {
    const removed = await this.repo.removeById(id);
    const actor = currentUser ?? 'unknown';
    await this.journal({ service: removed?.owner ?? 'manual', actor, level: 'info', event: 'deleted', routeKey: removed?.routeKey, method: removed?.method, path: removed?.path });
    this.logger.log(`[gw-path] ${actor} deleted '${removed?.routeKey ?? id}'`);
    return removed;
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathGet, 'rpc')
  async get(@BrokerParam('body', 'id') id: string): Promise<StoredHttpPath> {
    return this.repo.findById(id);
  }

  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathList, 'rpc')
  async list(@BrokerParam('body', 'page') page?: number, @BrokerParam('body', 'limit') limit?: number): Promise<PaginationModel<StoredHttpPath>> {
    return this.repo.filterPaginated({}, Number(page) || 1, Number(limit) || 10);
  }

  /** Free-text search over stored routes → PaginationModel<StoredHttpPath> (delegated to the repo). */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathSearch, 'rpc')
  async searchRoutes(@BrokerParam('body', 'q') q?: string, @BrokerParam('body', 'page') page?: number, @BrokerParam('body', 'limit') limit?: number): Promise<PaginationModel<StoredHttpPath>> {
    return this.repo.search(q, Number(page) || 1, Number(limit) || 10);
  }

  /** Responder for gateway.loadConfig.paths — all enabled paths, ordered static-before-param. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.pathExport, 'rpc')
  async export(): Promise<PathDefinition[]> {
    const paths = await this.repo.listEnabled();
    return orderPaths(paths);
  }

  /** Reads the route-change journal (auto-discovery + user CRUD), newest first. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.routeLogList, 'rpc')
  async logList(@BrokerParam('body', 'limit') limit?: number): Promise<RouteSyncLogEntry[]> {
    return this.logs.list(Number(limit) || 100);
  }

  /** Filtered + paginated journal query (who changed what, when) → PaginationModel. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.routeLogSearch, 'rpc')
  async logSearch(
    @BrokerParam('body', 'actor') actor?: string,
    @BrokerParam('body', 'service') service?: string,
    @BrokerParam('body', 'event') event?: string,
    @BrokerParam('body', 'routeKey') routeKey?: string,
    @BrokerParam('body', 'from') from?: number,
    @BrokerParam('body', 'to') to?: number,
    @BrokerParam('body', 'page') page?: number,
    @BrokerParam('body', 'limit') limit?: number,
  ): Promise<PaginationModel<RouteSyncLogEntry>> {
    return this.logs.query(
      { actor, service, event, routeKey, from: from != null ? Number(from) : undefined, to: to != null ? Number(to) : undefined },
      Number(page) || 1, Number(limit) || 20,
    );
  }

  /** Append a journal row for a user route action; best-effort (never breaks the request). */
  private async journal(entry: Omit<RouteSyncLogEntry, 'ts'>): Promise<void> {
    try { await this.logs.insert({ ts: Date.now(), ...entry }); }
    catch (e) { this.logger.warn(`[gw-path] journal write failed: ${(e as Error)?.message}`); }
  }
}
