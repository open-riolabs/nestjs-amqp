/** Publisher-side config: a microservice announcing its decorator-discovered HTTP routes. */
export interface RouteDiscoveryConfig {
  /** Logical service id; the ownership key for the routes this service publishes. Required to publish. */
  serviceName?: string;
  /** Publish the manifest automatically on application bootstrap (default true). */
  publishOnBoot?: boolean;
  /**
   * Fanout exchange the route manifests are published to / consumed from. Default
   * `ROUTE_DISCOVERY_EXCHANGE` ('rlb-route-discovery'). Override to namespace route-discovery per
   * environment/cluster on a shared broker — the SAME value MUST be set on the publishing
   * microservices AND on the gateway (they agree on it via this config, not a hardcoded constant).
   */
  exchange?: string;
  /**
   * Durable, shared work-queue the gateway(s) consume manifests from (competing consumers). Default
   * `ROUTE_SYNC_QUEUE` ('rlb-route-sync'). Must match between the publishers and the gateway.
   */
  queue?: string;
}

/**
 * What a microservice publishes to announce its HTTP routes to the gateway. The routes are
 * PathDefinition-shaped objects, kept loosely typed here so the broker layer does NOT depend on
 * the proxy layer (the gateway treats them as PathDefinition on receipt).
 */
export interface RouteManifest {
  service: string;
  routes: any[];
}
