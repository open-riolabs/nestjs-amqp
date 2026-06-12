---
name: rlb-amqp-add-ws-event
description: Add a secure WebSocket event (or HTTP webhook) to the @open-rlb/nestjs-amqp gateway by adding a gateway.events[] entry. Use when the user wants to push broker messages to connected WebSocket clients or to a webhook, with authentication (token in subprotocol), per-event roles/ACL, and per-user scoping to avoid leaking other users' data. Generates the YAML event fragment plus the exchange/queue and ws options, and flags the security wiring.
---

***REMOVED*** Add a WebSocket / webhook event (gateway.events[])

Read first:
- `.claude/skills/rlb-amqp/references/config-schema.md` (the `gateway.events[]` + `gateway.ws`
  sections)
- `.claude/skills/rlb-amqp/references/gotchas.md` (WebSocket items 16–18, ACL item 15)

A WS event subscribes to an exchange/routingKey and fans the messages out to the connected
clients of EVERY gateway instance. Secure it by default.

***REMOVED******REMOVED*** Decide

- **type**: `ws` (push to clients) or `http` (forward each message to a webhook `url`).
- **source**: `exchange` + `routingKey` (the exchange must exist in `broker.exchanges[]`;
  `connection_name` must be set — gotcha 8).
- **security**:
  - `auth: <provider>` → subscribing requires an authenticated connection.
  - `roles: [...]` → ACL check (needs `IAclRoleService`).
  - `scopeClaim` + `payloadKey` → per-user scoping: a client only receives messages where
    `payload[payloadKey] === client.auth[scopeClaim]`. `scopeClaim` is the MAPPED claim
    (with `headerPrefix`, e.g. `X-GTW-AUTH-USERID`). Without `payloadKey` it denies all
    (gotcha 16).

***REMOVED******REMOVED*** YAML fragments

```yaml
gateway:
  ws:                                   ***REMOVED*** set once for the gateway
    authProvider: gateway-jwks
    requireAuth: true
    maxConnections: 5000
    maxSubscriptionsPerClient: 50
    heartbeatIntervalMs: 30000

  events:
    - name: orders
      type: ws
      exchange: orders-ex               ***REMOVED*** must exist in broker.exchanges[]
      routingKey: orders.***REMOVED***
      auth: gateway-jwks
      roles: [orders.read]              ***REMOVED*** optional → needs IAclRoleService
      scopeClaim: X-GTW-AUTH-USERID     ***REMOVED*** optional per-user scoping
      payloadKey: userId

    - name: invoices                    ***REMOVED*** webhook variant
      type: http
      exchange: inv-ex
      routingKey: inv.***REMOVED***
      url: https://hooks.example.com/invoices
      method: POST
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
  `app.useWebSocketAdapter(new WsAdapter(app))`.
- `gateway.ws.authProvider` must reference a `jwt`/`jwks` provider; with `requireAuth: true`
  unauthenticated connections are closed (1008).
- `roles` → `IAclRoleService` via `RLB_GTW_ACL_ROLE_SERVICE` (gotcha 15).
- Do NOT add a fixed durable queue for the event — the lib creates a per-instance exclusive
  queue for fan-out (gotcha 17).

***REMOVED******REMOVED*** Client snippet (for docs/testing)

```js
const ws = new WebSocket('ws://localhost:3000', [token]);   // token in subprotocol
ws.onopen = () => ws.send(JSON.stringify({ action: 'subscribe', topic: 'orders' }));
ws.onmessage = (e) => console.log(JSON.parse(e.data)); // { topic:'onOrders', data } | { topic:'onError', ... }
```

Output the YAML fragments (with parent paths) and the bootstrap/ACL items still required.
