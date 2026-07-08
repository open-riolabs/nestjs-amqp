import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ConflictError } from '../../../common';
import { AmqpConnection } from '../../../amqp-lib';
import { BrokerService, RouteManifest } from '../../broker';
import { GW_RELOAD_ACTION, RLB_AMQP_GATEWAY_OPTIONS, ROUTE_DISCOVERY_EXCHANGE, ROUTE_SYNC_QUEUE } from '../../broker/const';
import { GatewayConfig } from '../../proxy/config/path-definition.config';
import { GatewayAdminModuleOptions } from '../config/gateway-admin.config';
import { RLB_GW_ADMIN_OPTIONS } from '../const';
import { RouteSyncLogEntry } from '../models';
import { HttpPathRepository } from '../repository/http-path.repository';
import { RouteSyncLogRepository } from '../repository/route-sync-log.repository';
import { diffRoutes } from '../util/route-diff';
import { renderChanges, routeKeyOf } from '../util/route-manifest';

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
    // Consumer-side route-discovery config (exchange/queue), supplied via GatewayAdminModule. The
    // names MUST match the publishers' broker.routeDiscovery. Optional → defaults to the constants.
    @Optional() @Inject(RLB_GW_ADMIN_OPTIONS) private readonly adminOptions?: GatewayAdminModuleOptions,
  ) { }

  async onApplicationBootstrap() {
    const exchange = this.adminOptions?.routeDiscovery?.exchange || ROUTE_DISCOVERY_EXCHANGE;
    const queue = this.adminOptions?.routeDiscovery?.queue || ROUTE_SYNC_QUEUE;
    try {
      await this.amqp.channel.assertExchange(exchange, 'fanout', { durable: true });
      await this.amqp.createSubscriber<RouteManifest>(
        async (msg: RouteManifest) => { await this.handle(msg); },
        {
          queue,
          exchange,
          routingKey: '',
          createQueueIfNotExists: true,
          queueOptions: { durable: true, exclusive: false, autoDelete: false },
        },
        queue,
      );
      this.logger.log(`[route-sync] listening on '${queue}' (exchange '${exchange}', competing consumers)`);
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
        // A collision with YAML or a manually-managed admin route ('manual') is an INTENTIONAL
        // operator override — re-journaling it on every announce is pure noise. Keep it as a debug
        // log only. A cross-SERVICE collision (two microservices claiming the same route) IS a real
        // conflict, so it stays a warn + a journal entry.
        if (c.conflictWith === 'yaml' || c.conflictWith === 'manual') {
          this.logger.debug(`[route-sync] ${service}: '${c.routeKey}' already owned by '${c.conflictWith}' → skipped`);
          continue;
        }
        this.logger.warn(`[route-sync] ${service}: collision on '${c.routeKey}' (owned by '${c.conflictWith}') → skipped`);
        await this.journal({ service, level: 'warn', event: 'collision', routeKey: c.routeKey, method: c.method, path: c.path, conflictWith: c.conflictWith, message: `route '${c.routeKey}' already owned by '${c.conflictWith}'; skipped` });
      }
      for (const inv of diff.invalid) {
        await this.journal({ service, level: 'error', event: 'invalid', message: `invalid route dropped: ${JSON.stringify(inv.route)?.slice(0, 200)}` });
      }
      for (const u of diff.upserts) {
        let added = u.added;
        try {
          if (u.existingId) await this.paths.updateById(u.existingId, u.model);
          else await this.paths.insert(u.model);
        } catch (e) {
          // The unique routeKey index is the authoritative guard the app-level reserve-check above
          // cannot provide (find-then-insert is racy across instances). A ConflictError here means
          // another writer inserted this routeKey between our check and our insert. Re-resolve the
          // current winner and reconcile instead of clobbering it.
          if (!(e instanceof ConflictError)) throw e;
          const clashes = await this.paths.findByRouteKey(u.routeKey);
          const mine = (clashes || []).find((c) => (c.owner ?? 'manual') === service);
          if (mine?._id) {
            // Same owner won the race (e.g. two of this service's manifests processed concurrently)
            // → idempotent update of the existing row, not a duplicate insert.
            await this.paths.updateById(mine._id, u.model);
            added = false;
          } else {
            // A DIFFERENT owner won → genuine cross-service collision. Skip + journal (mirrors the
            // diff.collisions path); never overwrite the winner's route.
            const conflictWith = (clashes || []).find((c) => (c.owner ?? 'manual') !== service)?.owner ?? 'manual';
            this.logger.warn(`[route-sync] ${service}: insert race lost on '${u.routeKey}' (won by '${conflictWith}') → skipped`);
            await this.journal({ service, level: 'warn', event: 'collision', routeKey: u.routeKey, method: u.model.method, path: u.model.path, conflictWith, message: `route '${u.routeKey}' claimed concurrently by '${conflictWith}'; skipped` });
            continue;
          }
        }
        const rendered = u.changes?.length ? renderChanges(u.changes) : undefined;
        await this.journal({ service, level: 'info', event: added ? 'added' : 'updated', routeKey: u.routeKey, method: u.model.method, path: u.model.path, topic: u.model.topic, action: u.model.action, changes: u.changes, message: rendered });
        if (rendered) this.logger.log(`[route-sync] ${service}: '${u.routeKey}' updated → ${rendered}`);
      }
      for (const d of diff.disables) {
        await this.paths.updateById(d.id, { enabled: false });
        await this.journal({ service, level: 'info', event: 'removed', routeKey: d.routeKey, method: d.method, path: d.path });
      }
      for (const s of diff.skipped) {
        this.logger.log(`[route-sync] ${service}: '${s.routeKey}' is user-modified → manifest update skipped (user version kept)`);
        await this.journal({ service, level: 'info', event: 'skipped', routeKey: s.routeKey, method: s.method, path: s.path, message: 'route user-modified; manifest update skipped' });
      }

      if (diff.changed) {
        await this.triggerReload();
        await this.journal({ service, level: 'info', event: 'reload', message: `${diff.upserts.length} upserted, ${diff.disables.length} removed, ${diff.skipped.length} user-modified skipped, ${diff.collisions.length} collision(s)` });
        this.logger.log(`[route-sync] ${service}: ${diff.upserts.length} upserted, ${diff.disables.length} removed, ${diff.skipped.length} user-modified skipped, ${diff.collisions.length} collision(s) → reload`);
      } else {
        this.logger.log(`[route-sync] ${service}: no route changes (${diff.skipped.length} user-modified skipped, ${diff.collisions.length} collision(s))`);
      }
    } catch (e) {
      this.logger.error(`[route-sync] handle failed: ${(e as Error)?.message}`);
    }
  }

  /** Write a journal entry; never throws (a failing log must not break the sync). Auto-discovery
   *  always acts as 'system' (overridable by the entry, though the sync never sets a user actor). */
  private async journal(entry: Omit<RouteSyncLogEntry, 'ts'>): Promise<void> {
    try { await this.logs.insert({ ts: Date.now(), actor: 'system', ...entry }); }
    catch (e) { this.logger.warn(`[route-sync] journal write failed: ${(e as Error)?.message}`); }
  }

  /** Broadcast a reload so EVERY gateway instance rebuilds its router from the DB. */
  private async triggerReload(): Promise<void> {
    const topic = this.gatewayConfig?.reloadTopic;
    if (!topic) {
      this.logger.warn('[route-sync] no gateway.reloadTopic configured; routes persisted but instances will not auto-reload.');
      return;
    }
    // Use the canonical reload action so the gateway's control subscriber accepts it (it now
    // ignores any non-'gw-reload' control message). The route-sync's OWN logic (diff/apply/journal)
    // stays in handle() above — this call only asks the gateway to rebuild its routes.
    try { await this.broker.publishMessage(topic, GW_RELOAD_ACTION, {}); }
    catch (e) { this.logger.error(`[route-sync] reload broadcast failed: ${(e as Error)?.message}`); }
  }
}
