import type { BrokerHttpDataSource } from '../../broker/decorators/broker-action.decorator';

export interface PathDefinition {
  name: string;
  method: string;
  path: string;
  parseRaw?: boolean;
  topic: string;
  action: string;
  successStatusCode?: number;
  // Single source of truth: the same set the @BrokerHTTP decorator accepts (see BrokerHttpDataSource).
  dataSource: BrokerHttpDataSource;
  mode: 'event' | 'rpc';
  auth?: string;
  allowAnonymous?: boolean;
  /** Actions the caller must hold to use this route (OR-semantics). The gateway verifies them
   *  against the request's (companyId, resourceId) via the ACL; omit/empty ⇒ no authorization. */
  actions?: string | string[];
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
  /** Actions the subscriber must hold (OR-semantics). Checked resource-agnostically (WS events
   *  carry no HTTP resource): a subscriber passes if any of their grants includes one of these. */
  actions?: string | string[];
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
   * per-event on WebSocketEvent (auth/requireAuth/actions/scopeClaim), not here.
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
  /**
   * Outbound backpressure cap (bytes, default 1 MiB): when a client's ws send buffer
   * (`bufferedAmount`) exceeds this, further event messages for that client are DROPPED
   * (a slow-but-pong-responsive client would otherwise grow gateway memory without bound).
   * Delivery resumes as soon as the client drains below the cap. Size it to
   * expected message size × tolerable burst.
   */
  maxBufferedBytes?: number;
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
  /**
   * Optional per-call metrics sink. When set, the gateway fires a fire-and-forget
   * track event (method/route/name/status/durationMs) after EVERY HTTP request it
   * serves — no manual call needed. Point it at the gateway-admin metrics handler,
   * e.g. { topic: 'rlb-gateway-admin', action: 'gw-metrics-track' }. Omit to disable.
   */
  metrics?: GatewayConfigSource;
  /**
   * Multipart upload limits. Uploads are buffered in gateway RAM (memoryStorage) and then
   * re-encoded into the AMQP message (~2-3x the file size per request), so these caps bound
   * gateway memory AND the resulting AMQP frame size (mind the broker's max_message_size).
   * Requests exceeding a limit are rejected with 413. Defaults: 25 MB/file, 10 files.
   */
  upload?: {
    /** Max size of a single uploaded file, in MB (default 25). */
    maxFileSizeMb?: number;
    /** Max number of files per request (default 10). */
    maxFiles?: number;
  };
  /**
   * Max number of HTTP requests processed concurrently by this instance. When the number of
   * in-flight requests reaches this cap, further requests are rejected immediately with 503
   * (Retry-After: 1) instead of piling up unbounded in-flight RPCs (which amplify memory and the
   * RPC correlation cost). Omit/0 ⇒ no cap (default). Size it to the instance's real capacity.
   */
  maxConcurrentRequests?: number;
  /**
   * Max size of a NON-multipart request body (JSON/urlencoded/text/raw), e.g. '5mb' or a number of
   * bytes. Multipart uploads are bounded separately by `upload`. Enforcement is applied by the app's
   * body parser (see the gateway bootstrap, which reads this value); requests over the limit get 413.
   * Omit to keep the framework default (~100kb).
   */
  maxBodyBytes?: number | string;
}