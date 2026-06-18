/** Publisher-side config: a microservice announcing its decorator-discovered HTTP routes. */
export interface RouteDiscoveryConfig {
  /** Logical service id; the ownership key for the routes this service publishes. Required to publish. */
  serviceName?: string;
  /** Publish the manifest automatically on application bootstrap (default true). */
  publishOnBoot?: boolean;
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
