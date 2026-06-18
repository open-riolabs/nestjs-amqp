import { Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { AmqpConnection } from '../../../amqp-lib';
import { buildPathDefinitionsFromMeta } from '../config/decorator-paths';
import { RouteDiscoveryConfig, RouteManifest } from '../config/route-discovery.config';
import { RLB_ROUTE_DISCOVERY_OPTIONS, ROUTE_DISCOVERY_EXCHANGE, ROUTE_SYNC_QUEUE } from '../const';
import { AutoDiscoveryService } from './auto-discovery.service';

/**
 * Lets a microservice ANNOUNCE itself: on bootstrap it maps this app's @BrokerHTTP/@BrokerAction
 * metadata (`AutoDiscoveryService.meta`) into route definitions and publishes them to the gateway
 * as a durable, persistent manifest. Lives in BrokerModule so any microservice can publish — the
 * gateway only RECEIVES (RouteSyncService, in GatewayAdminModule).
 *
 * Activated only when `routeDiscovery.serviceName` is configured (otherwise a no-op). Fire-and-
 * forget: if no gateway consumer is up yet, the durable queue buffers the manifest until one connects.
 */
@Injectable()
export class RouteDiscoveryPublisherService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RouteDiscoveryPublisherService.name);

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly autoDiscovery: AutoDiscoveryService,
    @Optional() @Inject(RLB_ROUTE_DISCOVERY_OPTIONS) private readonly config?: RouteDiscoveryConfig,
  ) { }

  async onApplicationBootstrap() {
    if (!this.config?.serviceName || this.config.publishOnBoot === false) return; // not a publisher
    await this.publish();
  }

  /** Build and publish this service's route manifest. Returns the publisher-confirm result. */
  async publish(): Promise<boolean> {
    const service = this.config?.serviceName;
    if (!service) {
      this.logger.error('[route-discovery] routeDiscovery.serviceName is required to publish; skipped.');
      return false;
    }
    const routes = buildPathDefinitionsFromMeta(this.autoDiscovery?.meta || {});
    const manifest: RouteManifest = { service, routes };
    try {
      // Ensure the durable topology exists BEFORE publishing, so the manifest is never lost even
      // if the gateway consumer hasn't subscribed yet (the durable queue buffers it).
      await this.amqp.channel.assertExchange(ROUTE_DISCOVERY_EXCHANGE, 'fanout', { durable: true });
      await this.amqp.channel.assertQueue(ROUTE_SYNC_QUEUE, { durable: true, exclusive: false, autoDelete: false });
      await this.amqp.channel.bindQueue(ROUTE_SYNC_QUEUE, ROUTE_DISCOVERY_EXCHANGE, '');
      const ok = await this.amqp.publish(ROUTE_DISCOVERY_EXCHANGE, '', manifest, { persistent: true });
      this.logger.log(`[route-discovery] published manifest for '${service}': ${routes.length} route(s)`);
      return ok;
    } catch (e) {
      this.logger.error(`[route-discovery] publish failed: ${(e as Error)?.message}`);
      return false;
    }
  }
}
