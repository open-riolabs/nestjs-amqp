export interface EnableRouteDiscoveryOptions {
  /** Logical service name published for auto-discovery. Prompted when omitted; kebab/snake-normalized. */
  serviceName?: string;
  /** Discovery exchange (fanout). Default: 'rlb-route-discovery'. */
  exchange?: string;
  /** Queue the gateway syncs from. Default: 'rlb-route-sync'. */
  queue?: string;
  /** Publish the route manifest on boot. Default: true. */
  publishOnBoot?: boolean;
  /** Also declare the discovery exchange in broker.exchanges. Default: true. */
  declareExchange?: boolean;
  /** Update broker.routeDiscovery when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
