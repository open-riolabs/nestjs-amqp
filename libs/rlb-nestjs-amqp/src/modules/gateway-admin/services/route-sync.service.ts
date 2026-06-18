import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AmqpConnection } from '../../../amqp-lib';
import { BrokerService, RouteManifest } from '../../broker';
import { RLB_AMQP_GATEWAY_OPTIONS, ROUTE_DISCOVERY_EXCHANGE, ROUTE_SYNC_QUEUE } from '../../broker/const';
import { GatewayConfig } from '../../proxy/config/path-definition.config';
import { RouteSyncLogEntry } from '../models';
import { HttpPathRepository } from '../repository/http-path.repository';
import { RouteSyncLogRepository } from '../repository/route-sync-log.repository';
import { diffRoutes } from '../util/route-diff';
import { routeKeyOf } from '../util/route-manifest';

/**
 * Gateway side of route auto-discovery. Consumes route manifests from the shared durable queue
 * (competing consumers → one instance processes each manifest), diffs them against the DB scoped
 * to the publishing service (identity = method+path), persists only what changed (soft-disable
 * stale, skip+log cross-owner collisions), writes a journal entry per change, then broadcasts a
 * reload. Wired by GatewayAdminModule.
 */
@Injectable()
export class RouteSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RouteSyncService.name);

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly broker: BrokerService,
    private readonly paths: HttpPathRepository,
    private readonly logs: RouteSyncLogRepository,
    @Inject(RLB_AMQP_GATEWAY_OPTIONS) private readonly gatewayConfig: GatewayConfig,
  ) { }

  async onApplicationBootstrap() {
    try {
      await this.amqp.channel.assertExchange(ROUTE_DISCOVERY_EXCHANGE, 'fanout', { durable: true });
      await this.amqp.createSubscriber<RouteManifest>(
        async (msg: RouteManifest) => { await this.handle(msg); },
        {
          queue: ROUTE_SYNC_QUEUE,
          exchange: ROUTE_DISCOVERY_EXCHANGE,
          routingKey: '',
          createQueueIfNotExists: true,
          queueOptions: { durable: true, exclusive: false, autoDelete: false },
        },
        ROUTE_SYNC_QUEUE,
      );
      this.logger.log(`[route-sync] listening on '${ROUTE_SYNC_QUEUE}' (exchange '${ROUTE_DISCOVERY_EXCHANGE}', competing consumers)`);
    } catch (e) {
      this.logger.error(`[route-sync] subscribe failed: ${(e as Error)?.message}`);
    }
  }

  /** Process one manifest. Never throws (errors are logged → message is acked, no poison loop). */
  private async handle(manifest: RouteManifest): Promise<void> {
    try {
      const service = manifest?.service;
      if (!service) { this.logger.warn('[route-sync] manifest without `service`; ignored'); return; }
      const routes = Array.isArray(manifest.routes) ? manifest.routes : [];

      const existing = await this.paths.findByOwner(service);
      if (routes.length === 0 && existing.length > 0) {
        this.logger.warn(`[route-sync] ${service}: manifest is EMPTY but ${existing.length} route(s) exist for this service → all will be soft-disabled. Verify the publisher is not mis-firing.`);
      }

      // Reserved keys = YAML routes + routes owned by ANYONE else (another service OR a manually
      // managed admin route, which has no `owner` and is treated as 'manual'). Any enabled state
      // counts — a soft-disabled route still owns its (method, path), so we must not clobber it.
      const reserved = new Map<string, string>();
      for (const p of this.gatewayConfig?.paths || []) reserved.set(routeKeyOf(p), 'yaml');
      for (const r of routes) {
        const key = routeKeyOf(r);
        if (reserved.has(key)) continue;
        const clashes = await this.paths.findByRouteKey(key);
        const other = (clashes || []).find((c) => (c.owner ?? 'manual') !== service);
        if (other) reserved.set(key, other.owner ?? 'manual');
      }

      const diff = diffRoutes(service, routes, existing, reserved);

      // --- Apply + journal (one entry per change) ------------------------------
      for (const c of diff.collisions) {
        this.logger.warn(`[route-sync] ${service}: collision on '${c.routeKey}' (owned by '${c.conflictWith}') → skipped`);
        await this.journal({ service, level: 'warn', event: 'collision', routeKey: c.routeKey, method: c.method, path: c.path, conflictWith: c.conflictWith, message: `route '${c.routeKey}' already owned by '${c.conflictWith}'; skipped` });
      }
      for (const inv of diff.invalid) {
        await this.journal({ service, level: 'error', event: 'invalid', message: `invalid route dropped: ${JSON.stringify(inv.route)?.slice(0, 200)}` });
      }
      for (const u of diff.upserts) {
        if (u.existingId) await this.paths.updateById(u.existingId, u.model);
        else await this.paths.insert(u.model);
        await this.journal({ service, level: 'info', event: u.added ? 'added' : 'updated', routeKey: u.routeKey, method: u.model.method, path: u.model.path, topic: u.model.topic, action: u.model.action });
      }
      for (const d of diff.disables) {
        await this.paths.updateById(d.id, { enabled: false });
        await this.journal({ service, level: 'info', event: 'removed', routeKey: d.routeKey, method: d.method, path: d.path });
      }

      if (diff.changed) {
        await this.triggerReload();
        await this.journal({ service, level: 'info', event: 'reload', message: `${diff.upserts.length} upserted, ${diff.disables.length} removed, ${diff.collisions.length} collision(s)` });
        this.logger.log(`[route-sync] ${service}: ${diff.upserts.length} upserted, ${diff.disables.length} removed, ${diff.collisions.length} collision(s) → reload`);
      } else {
        this.logger.log(`[route-sync] ${service}: no route changes (${diff.collisions.length} collision(s))`);
      }
    } catch (e) {
      this.logger.error(`[route-sync] handle failed: ${(e as Error)?.message}`);
    }
  }

  /** Write a journal entry; never throws (a failing log must not break the sync). */
  private async journal(entry: Omit<RouteSyncLogEntry, 'ts'>): Promise<void> {
    try { await this.logs.insert({ ts: Date.now(), ...entry }); }
    catch (e) { this.logger.warn(`[route-sync] journal write failed: ${(e as Error)?.message}`); }
  }

  /** Broadcast a reload so EVERY gateway instance rebuilds its router from the DB. */
  private async triggerReload(): Promise<void> {
    const topic = this.gatewayConfig?.reloadTopic;
    if (!topic) {
      this.logger.warn('[route-sync] no gateway.reloadTopic configured; routes persisted but instances will not auto-reload.');
      return;
    }
    try { await this.broker.publishMessage(topic, 'route-sync', {}); }
    catch (e) { this.logger.error(`[route-sync] reload broadcast failed: ${(e as Error)?.message}`); }
  }
}
