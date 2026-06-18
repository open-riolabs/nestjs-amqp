export interface GatewayAdminModuleOptions {
  /** Broker topic to bind handlers to (default GATEWAY_ADMIN_TOPIC = 'rlb-gateway-admin'). */
  topic?: string;
  /**
   * Route auto-discovery — CONSUMER side. The gateway receives microservice route manifests here.
   * Only the exchange/queue names are needed (no serviceName: the gateway publishes nothing and
   * keeps its own connection_name). These MUST match the publishers' broker.routeDiscovery values.
   * Defaults: exchange 'rlb-route-discovery', queue 'rlb-route-sync'.
   */
  routeDiscovery?: {
    exchange?: string;
    queue?: string;
  };
}
