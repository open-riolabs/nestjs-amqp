/** Delivery transport for the event. Mirrors WebSocketEvent['type'] (ws push or http webhook). */
export type WsEventType = 'ws' | 'http';

export interface AddWsEventOptions {
  /** Event name (the key). Prompted when omitted. */
  name?: string;
  /** ws (push to subscribed clients) | http (webhook POST). Default: ws. */
  type?: WsEventType;
  /** Source exchange the gateway binds to (ws). */
  exchange?: string;
  /** routingKey bound on that exchange (ws). */
  routingKey?: string;
  /** Auth-provider name used to verify the subscribe token AND map its claims. */
  auth?: string;
  /** Set false to make `auth` optional (anonymous may subscribe; authed still get claims mapped). */
  requireAuth?: boolean;
  /** Actions the subscriber must hold (OR-semantics), checked resource-agnostically. Requires `auth`. */
  actions?: string | string[];
  /** Claim used to scope delivery per-user; requires `payloadKey` to compare against. */
  scopeClaim?: string;
  /** Payload field compared against `scopeClaim` — only matching messages are forwarded. */
  payloadKey?: string;
  /** Webhook URL to POST to (http). */
  url?: string;
  /** HTTP method for the webhook (http) — written as `method`. */
  httpMethod?: string;
  /** Webhook request timeout in ms (http). */
  timeout?: number;
  /** Update the entry when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
