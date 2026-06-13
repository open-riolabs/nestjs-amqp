export interface PathDefinition {
  name: string;
  method: string;
  path: string;
  parseRaw?: boolean;
  topic: string;
  action: string;
  successStatusCode?: number;
  dataSource: 'body' | 'query' | 'params' | 'body-query' | 'query-body';
  mode: 'event' | 'rpc';
  auth?: string;
  allowAnonymous?: boolean;
  roles: string[];
  timeout?: number;
  binary?: boolean;
  headers: {
    [k: string]: string | string[] | number;
  };
  forwardHeaders: {
    [k: string]: string;
  };
  redirect: number;
}

export interface WebSocketEvent {
  type: 'ws' | 'mqtt' | 'http';
  exchange: string;
  routingKey: string;
  name: string;
  /**
   * Auth-provider name used to verify the connection token AND map its claims for
   * this specific event (verification happens at subscribe time). When set, a valid
   * token is required to subscribe unless `requireAuth` is explicitly `false`.
   */
  auth?: string;
  /**
   * Set to `false` to make `auth` optional: anonymous clients may subscribe, while
   * authenticated ones still get their claims mapped (useful with `scopeClaim`).
   * Defaults to `true` when `auth` is set.
   */
  requireAuth?: boolean;
  roles?: string[];
  /**
   * When set, the server only forwards messages whose `payload[payloadKey]`
   * equals the authenticated client's `scopeClaim` value. Prevents a client
   * from receiving other users' data via a crafted `select` filter.
   */
  scopeClaim?: string;
  payloadKey?: string;
  url?: string;
  method?: string;
  headers?: { [k: string]: string | string[] | number; };
  timeout?: number;
}

export interface WebSocketGatewayOptions {
  /**
   * Connection-level limits and heartbeat. Authentication/authorization is declared
   * per-event on WebSocketEvent (auth/requireAuth/roles/scopeClaim), not here.
   */
  /** Maximum number of concurrent connections accepted by this instance. */
  maxConnections?: number;
  /** Maximum number of active subscriptions per connected client. */
  maxSubscriptionsPerClient?: number;
  /** Ping/pong heartbeat interval in milliseconds (default 30000). */
  heartbeatIntervalMs?: number;
  /**
   * Allowlist of accepted `Origin` headers for the WS handshake. When set,
   * connections from other origins are closed (defense against cross-site WS).
   * When omitted, all origins are accepted (logged at boot).
   */
  allowedOrigins?: string[];
  /** Max size (bytes) of an inbound client message; larger ones are dropped (default 16384). */
  maxMessageBytes?: number;
}

export interface GatewayConfigLoader {
  paths?: GatewayConfigSource,
  events?: GatewayConfigSource,
}

export interface GatewayConfigSource {
  topic: string,
  action: string,
  tags?: string[];
}

export interface GatewayConfig {
  headerPrefix?: string;
  loadConfig?: GatewayConfigLoader;
  paths: PathDefinition[];
  events: WebSocketEvent[];
  ws?: WebSocketGatewayOptions;
  /**
   * Optional broadcast topic the gateway subscribes to for runtime route reloads.
   * When a message arrives on this topic, the gateway rebuilds its route table from
   * the YAML paths + `loadConfig.paths` (DB export) without restarting. Trigger it by
   * publishing to this topic (e.g. an `event`-mode path like POST /admin/reload, or
   * automatically after a path CRUD). Use `broadcast` mode so every instance reloads.
   */
  reloadTopic?: string;
}