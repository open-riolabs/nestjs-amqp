---
name: rlb-amqp-add-ws-event
description: Add a secure WebSocket event (or HTTP webhook) to the @open-rlb/nestjs-amqp gateway by adding a gateway.events[] entry. Use when the user wants to push broker messages to connected WebSocket clients or to a webhook, with authentication (token in subprotocol), per-event roles/ACL, and per-user scoping to avoid leaking other users' data. Generates the YAML event fragment plus the exchange/queue and ws options, and flags the security wiring.
---

***REMOVED*** Add a WebSocket / webhook event (gateway.events[])

Read first:
- `.claude/skills/rlb-amqp/references/config-schema.md` (the `gateway.events[]` + `gateway.ws`
  sections)
- `.claude/skills/rlb-amqp/references/gotchas.md` (WebSocket items 16–18, 26–27; ACL item 15)

A WS event binds a broker `exchange`/`routingKey` to a named client-facing stream and fans
each message out to the connected clients of EVERY gateway instance. Secure it by default.

***REMOVED******REMOVED*** Decide

- **type**: `ws` (push to clients) or `http` (forward each message to a webhook `url`).
  (`mqtt` is also accepted by the type union but `ws`/`http` are the supported paths.)
- **source**: `exchange` + `routingKey` (the exchange must exist in `broker.exchanges[]`;
  each instance needs a distinct `connection_name` — gotcha 8).
- **client-facing name**: clients subscribe by `name`; messages arrive as `on<Name>`
  (first letter capitalized — `chat` → `onChat`).
- **security**:
  - `auth: <provider>` → the provider that verifies the connection token AND maps its claims
    for THIS event (at subscribe time, memoized per provider). When set, a valid token is
    required to subscribe.
  - `requireAuth: false` → makes `auth` optional (anonymous allowed; claims mapped if a token
    is present — handy with `scopeClaim`). Defaults to `true` when `auth` is set.
  - `roles: [...]` → ACL check (needs `IAclRoleService`); requires `auth` for the identity.
  - `scopeClaim` + `payloadKey` → per-user isolation: a client only receives messages where
    `payload[payloadKey] === claims[scopeClaim]`. `scopeClaim` is the MAPPED claim
    (with `headerPrefix`, e.g. `X-GTW-AUTH-USERID`). Without `payloadKey` it denies all
    (gotcha 16). With `auth` but no `scopeClaim`/`payloadKey`, every authorized subscriber
    gets ALL messages (warned at boot).

> Auth/roles/scope are declared PER-EVENT. `gateway.ws` only holds connection-level limits,
> heartbeat, origin allowlist and message-size cap (no auth fields). Different events may use
> different providers.

***REMOVED******REMOVED*** YAML fragments

```yaml
gateway:
  ws:                                   ***REMOVED*** connection-level only (optional)
    maxConnections: 5000                ***REMOVED*** max concurrent connections this instance accepts
    maxSubscriptionsPerClient: 50       ***REMOVED*** max active subscriptions per client
    heartbeatIntervalMs: 30000          ***REMOVED*** ping/pong; also drops dead sockets + expired tokens
    allowedOrigins:                     ***REMOVED*** reject cross-site handshakes; omit → all origins (logged)
      - https://app.example.com
    maxMessageBytes: 16384              ***REMOVED*** inbound client frame cap; larger frames dropped (default)

  events:
    - name: orders
      type: ws
      exchange: orders-ex               ***REMOVED*** must exist in broker.exchanges[]
      routingKey: orders.***REMOVED***
      auth: gateway-jwks                ***REMOVED*** verifies token + maps claims for this event
      requireAuth: true                 ***REMOVED*** default true when auth is set; false → optional
      roles: [orders.read]              ***REMOVED*** optional → needs IAclRoleService
      scopeClaim: X-GTW-AUTH-USERID     ***REMOVED*** optional per-user scoping (MAPPED claim)
      payloadKey: userId                ***REMOVED*** message field compared to scopeClaim

    - name: invoices                    ***REMOVED*** webhook variant
      type: http
      exchange: inv-ex
      routingKey: inv.***REMOVED***
      url: https://hooks.example.com/invoices
      method: POST
      headers: { x-api-key: secret }
      timeout: 8000
```

Ensure the exchange exists:

```yaml
broker:
  exchanges:
    - name: orders-ex
      type: topic
      createExchangeIfNotExists: true
      options: { durable: true }
```

***REMOVED******REMOVED*** Required wiring to flag

- The app bootstrap must register the WS adapter:
  `app.useWebSocketAdapter(new WsAdapter(app))` (see
  `sample/config-sample/gateway-in-memory/src/main.ts`).
- `events[].auth` must reference a `jwt`/`jwks` provider; subscribing without a valid token
  yields `{ topic:'onError', data:{ event, error:'unauthorized' } }` (unless `requireAuth:false`).
  A failed role check yields `error:'forbidden'`.
- `roles` → `IAclRoleService` via `RLB_GTW_ACL_ROLE_SERVICE` in
  `ProxyModule.forRootAsync({ providers: [...] })` (gotcha 15).
- Do NOT add a fixed durable queue for the event — the lib creates a per-instance exclusive
  ephemeral auto-delete queue for fan-out (gotcha 17).
- WS sessions are bounded by the token `exp`: the socket is closed (`1008`) when the JWT
  expires; long-lived sockets need refresh + reconnect (gotcha 26).

***REMOVED******REMOVED*** Client snippet (for docs/testing)

```js
// token in subprotocol — browsers can't set custom handshake headers (gotcha 18).
// single value = token; ['bearer', token] / ['jwt', token] pairs also accepted.
const ws = new WebSocket('ws://localhost:3000', [token]);
ws.onopen = () => ws.send(JSON.stringify({ action: 'subscribe', topic: 'orders' }));
ws.onmessage = (e) => console.log(JSON.parse(e.data)); // { topic:'onOrders', data } | { topic:'onError', ... }
// unsubscribe: ws.send(JSON.stringify({ action: 'unsubscribe', topic: 'orders' }));
```

> An optional `select: { key: value }` in the subscribe frame is a client-side filter
> (forwarded only when `payload[key] === value` for every key). It is INTERSECTED with the
> server-enforced `scopeClaim` isolation — a `select` can never widen what a user receives.

Output the YAML fragments (with parent paths) and the bootstrap/ACL items still required.
