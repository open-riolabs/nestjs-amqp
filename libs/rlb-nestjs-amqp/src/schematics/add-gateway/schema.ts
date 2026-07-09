export interface AddGatewayOptions {
  /** Main AMQP exchange backing the acl/admin queues. Default: 'rlb'. */
  exchange?: string;
  /** Queue backing the fixed rlb-acl topic. Default: 'rlb-acl'. */
  aclQueue?: string;
  /** Queue backing the fixed rlb-gateway-admin topic. Default: 'rlb-gateway-admin'. */
  adminQueue?: string;
  /** Broadcast control/reload topic name. Default: 'rlb-gateway-control'. */
  controlTopic?: string;
  /** Route-discovery fanout exchange (consumer side). Default: 'rlb-route-discovery'. */
  routeExchange?: string;
  /** Route-sync durable queue (consumer side). Default: 'rlb-route-sync'. */
  routeQueue?: string;
  /** Include ACL infra (rlb-acl topic/queue). Default: true. */
  acl?: boolean;
  /** Include gateway-admin infra (rlb-gateway-admin topic/queue + control topic). Default: true. */
  admin?: boolean;
  /** Consume routes auto-published by microservices (route-sync infra). Default: true. */
  routeReception?: boolean;
  /** Update entries that already exist (default: leave them untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
