/** HTTP verb for the route. Mirrors PathDefinition['method']. */
export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
/** Where the gateway reads the RPC payload from. Mirrors BrokerHttpDataSource. */
export type RouteDataSource = 'body' | 'query' | 'params' | 'body-query' | 'query-body';
/** rpc = wait for the reply; event = fire-and-forget (confirm only). */
export type RouteMode = 'rpc' | 'event';

export interface AddRouteOptions {
  /** Route name (the key). Prompted when omitted. */
  name?: string;
  /** HTTP method. Default: GET. */
  method?: RouteMethod;
  /** URL path (e.g. /orders/:id). Prompted when omitted. */
  path?: string;
  /** Where to read the payload from. Default: query for GET, body otherwise. */
  dataSource?: RouteDataSource;
  /** Broker topic the request forwards to. Prompted when omitted. */
  topic?: string;
  /** Broker action invoked on that topic. Prompted when omitted. */
  action?: string;
  /** rpc (wait reply) | event (fire-and-forget). Default: rpc. */
  mode?: RouteMode;
  /** RPC reply timeout in ms. */
  timeout?: number;
  /** Auth-provider name that must verify the caller. */
  auth?: string;
  /** Allow anonymous callers even when `auth` is set. */
  allowAnonymous?: boolean;
  /** Actions the caller must hold (OR-semantics) — gated via the ACL. Requires `auth`. */
  actions?: string | string[];
  /** HTTP status returned on success. */
  successStatusCode?: number;
  /** Return the reply as a raw binary buffer. */
  binary?: boolean;
  /** Respond with this redirect status instead of a body. */
  redirect?: number;
  /** Forward the raw (unparsed) request body — needs rawBody:true at bootstrap. */
  parseRaw?: boolean;
  /** Update the entry when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
