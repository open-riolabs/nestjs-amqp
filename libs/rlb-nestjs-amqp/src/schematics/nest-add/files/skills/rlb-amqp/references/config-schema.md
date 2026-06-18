***REMOVED*** config.yaml — full schema

Five top-level sections: `app`, `broker`, `topics`, `auth-providers`, `gateway`.
Loaded by `config/config.loader.ts`. `app`/`broker`/`topics` → `BrokerModule.forRoot(broker, topics, app?)`;
`auth-providers` + `gateway` → `ProxyModule.forRootAsync` (`authOptions` / `gatewayOptions`).
Gateway-admin repos + the consumer-side `routeDiscovery` are wired in NEST code via
`GatewayAdminModule.forRoot/forRootAsync` — not YAML.

Authoritative sources: `docs/broker.md`, `docs/gateway.md`, `docs/gateway-admin.md`,
`docs/acl.md`, and the annotated reference YAMLs under `sample/config-sample/`
(`broker.yaml`, `gateway.yaml`, `acl.yaml`, `gateway-admin.yaml`).

> **Decorator-bound vs configurable.** Topic NAMES `rlb-acl` / `rlb-gateway-admin` /
> `rlb-gateway-control` and ALL action strings are fixed in code — write them exactly.
> `exchange` / `queue` / `routingKey` and the route-discovery `exchange` / `queue` ARE
> configurable.

---

***REMOVED******REMOVED*** app

```yaml
app:
  port: 3000
  host: 0.0.0.0
  environment: development   ***REMOVED*** development | production — controls error detail exposed by the gateway
```

`AppConfig` = `{ environment, port?, host? }`. In `production` gateway errors are reduced
to `{ message, name }`; in `development` the full detail/stack is included.

---

***REMOVED******REMOVED*** broker  (RabbitMQConfig)

```yaml
broker:
  name: rabbitmq                                ***REMOVED*** cosmetic label (optional)
  uri: "amqp://user:pass@host:5672/vhost"       ***REMOVED*** string | string[] (failover); vhost after last "/"
  prefetchCount: 10                             ***REMOVED*** default channel prefetch
  defaultRpcTimeout: 10000                      ***REMOVED*** ms (call arg → topic → this → 10000)
  defaultSubscribeErrorBehavior: ack            ***REMOVED*** ack | nack | requeue (lib default REQUEUE)
  defaultPublishErrorBehavior: reject

  routeDiscovery:                               ***REMOVED*** PUBLISHER-side route auto-discovery (microservice only)
    serviceName: demo-ms                        ***REMOVED*** required to publish; fills connection_name if unset
    publishOnBoot: true                         ***REMOVED*** default true — announce manifest on bootstrap
    exchange: rlb-route-discovery               ***REMOVED*** default; MUST match the gateway consumer
    queue: rlb-route-sync                        ***REMOVED*** default; MUST match the gateway consumer

  connectionManagerOptions:                     ***REMOVED*** amqp-connection-manager options
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:
      clientProperties:
        connection_name: my-service-1            ***REMOVED*** DISTINCT per instance for broadcast + WebSocket
      credentials:
        mechanism: PLAIN                         ***REMOVED*** PLAIN | EXTERNAL | AMQPLAIN (case-insensitive)
        username: guest
        password: guest

  connectionInitOptions:                        ***REMOVED*** block on a healthy connection at boot?
    wait: true                                   ***REMOVED*** default true
    timeout: 5000                                ***REMOVED*** default 5000 ms
    reject: true                                 ***REMOVED*** default true → throw on timeout

  exchanges:                                    ***REMOVED*** RabbitMQExchangeConfig[]
    - name: rlb
      type: direct                               ***REMOVED*** direct | topic | fanout | headers
      createExchangeIfNotExists: true            ***REMOVED*** false → checkExchange (must pre-exist)
      options: { durable: true, autoDelete: false, internal: false }

  queues:                                       ***REMOVED*** RabbitMQQueueConfig[]
    - name: rlb-acl
      exchange: rlb
      routingKey: rlb-acl                         ***REMOVED*** string | string[]; REQUIRED if exchange type == topic
      createQueueIfNotExists: true
      options: { durable: true, exclusive: false, autoDelete: false }
      consumerTag: my-tag                         ***REMOVED*** optional, unique per channel

  replyQueues:                                  ***REMOVED*** map exchange → reply queue (RPC responses)
    rlb: rlb-reply                                ***REMOVED*** omit → RabbitMQ direct-reply-to is used
```

Notes:
- `exchanges[]` / `queues[]` are asserted/checked once at boot; `replyQueues` values auto-consumed.
- `routeDiscovery.serviceName` doubles as `connection_name` when no explicit `clientProperties.connection_name`
  is set (explicit always wins). The **gateway** (consumer) does NOT use `broker.routeDiscovery` —
  it sets its side via `GatewayAdminModule` `routeDiscovery { exchange, queue }`; both sides must match.
- Do NOT declare a `broadcast` topic's per-instance queue here — the broker asserts
  `${topic}-${connection_name}` for you at subscribe time.
- Other optional fields: `defaultAlternateExchange` (divert unroutable), `onUnroutableMessage`
  (callback, needs `mandatory: true` publishes), per-channel `channels` map.

---

***REMOVED******REMOVED*** topics  (BrokerTopic[])

A topic maps a logical name to an AMQP path. `mode` decides the semantics.

```yaml
topics:
  - name: rlb-acl            ***REMOVED*** logical name (must match @BrokerAction / requestData / gateway)
    mode: rpc                 ***REMOVED*** rpc | handle | broadcast | event
    queue: rlb-acl            ***REMOVED*** for rpc/handle: must exist in broker.queues[]
    exchange: rlb             ***REMOVED*** exchange name
    routingKey: rlb-acl       ***REMOVED*** broadcast / topic exchanges
    errorBehavior: ack        ***REMOVED*** per-topic override of defaultSubscribeErrorBehavior (default REQUEUE)
    mandatory: false          ***REMOVED*** publish with AMQP `mandatory` (unroutable → returned)
    persistent: false         ***REMOVED*** publish delivery-mode 2 (survives restart if queue durable)
    toObservable: false       ***REMOVED*** handle only: route to BrokerService.events$ instead of a handler
```

| mode        | required fields                                  | notes                                                              |
| ----------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `rpc`       | `name`, `queue` (or `exchange`)                  | request/response + timeout; also the mode `@BrokerAction` uses     |
| `handle`    | `name`, `queue`                                  | plain consumer, no reply (`registerHandler` / `toObservable`)      |
| `broadcast` | `name`, `exchange`, `routingKey`                 | per-instance queue `${topic}-${connection_name}`; distinct name    |
| `event`     | `name`, `exchange`+`routingKey` (or `queue`)     | fire-and-forget publish; no consumer asserted for the topic        |

> A single `@BrokerAction` topic registers ONE consumer; multiple actions on the same
> topic share it and are dispatched by `action`. The gateway control topic
> (`rlb-gateway-control`) is `broadcast` so every instance reloads.

---

***REMOVED******REMOVED*** auth-providers  (HandlerAuthConfig[])

Top-level (NOT under `gateway`). Each provider VALIDATES a token and MAPS its claims into
forwarded `X-GTW-AUTH-*` headers. Referenced by `paths[].auth` / `events[].auth` by `name`.

```yaml
auth-providers:
  - name: gateway-jwks
    type: jwks                       ***REMOVED*** jwt | jwks | basic | str-compare | none
    headerPrefix: "X-GTW-AUTH-"      ***REMOVED*** prefix for mapped claim headers (and <prefix>USERID)
    uidClaim: sub                    ***REMOVED*** claim → <prefix>USERID; REQUIRED for role checks
    jwtMap:                          ***REMOVED*** 'source:dest' pairs → <prefix><DEST>; WITHOUT it NO claims forwarded
      - sub:userId                   ***REMOVED***   → X-GTW-AUTH-USERID
      - email:email                  ***REMOVED***   → X-GTW-AUTH-EMAIL
      - preferred_username:username  ***REMOVED***   → X-GTW-AUTH-USERNAME
      - roles:roles                  ***REMOVED***   → X-GTW-AUTH-ROLES
    algorithms: [RS256]              ***REMOVED*** REQUIRED for jwt/jwks; jwks allows only RS*/ES*/PS*
    issuer: https://issuer/realms/x  ***REMOVED*** expected `iss`
    jwksUri: https://issuer/certs    ***REMOVED*** jwks only
    secret: s3cr3t                   ***REMOVED*** jwt (HS secret) / str-compare (expected token string)
    audience: my-aud                 ***REMOVED*** jwt only (optional)
    clientId: u                      ***REMOVED*** basic only (username)
    clientSecret: p                  ***REMOVED*** basic only (password)
    httpsAllowUnauthorized: false    ***REMOVED*** true ONLY for self-signed dev issuers
```

Type behaviour:
- **`jwt` / `jwks`** — verify `Authorization: Bearer <token>`, then map via `jwtMap`.
- **`basic`** — verify `Authorization: Basic` vs `clientId`/`clientSecret`; maps username to
  `<prefix>USERNAME`/`<prefix>USERID`. **No `clientSecret` → passes through** (open by design).
- **`str-compare`** — compare raw `Authorization` to `secret`; maps to `<prefix>TOKEN`.
  **No `secret` → passes through.**

Hardening: `algorithms` REQUIRED for `jwt`/`jwks` (omit → denied; algorithm-confusion guard).
Define `jwtMap` or no identity is forwarded (token still `success:true` — fail-safe, not leak).
`usernameClaim` is deprecated; `aclTopic`/`aclAction` are removed (gateway role check is in-process
via `IAclRoleService.canUserDoGtw`).

> DB-stored auth-providers (name-keyed `gw-auth-*` upserts) layer on top of this static list —
> see `docs/gateway-admin.md`.

---

***REMOVED******REMOVED*** gateway  (GatewayConfig)

```yaml
gateway:
  mode: gateway
  headerPrefix: "X-FWD-"             ***REMOVED*** prefix for FORWARDED request headers (forwardHeaders);
                                     ***REMOVED***   separate from a provider's headerPrefix (auth claims)

  reloadTopic: rlb-gateway-control   ***REMOVED*** broadcast control topic; action 'gw-reload' rebuilds routes
  metrics:                           ***REMOVED*** per-call broker sink (omit to disable)
    topic: rlb-gateway-admin
    action: gw-metrics-track

  loadConfig:                        ***REMOVED*** pull DB-stored routes/events, merged with YAML, on (re)load
    paths:  { topic: rlb-gateway-admin, action: gw-path-export }    ***REMOVED*** gateway-admin ships this handler
    ***REMOVED*** events: { topic: <topic>, action: <your-export-action> }     ***REMOVED*** optional; NO built-in handler — provide your own

  ws:                                ***REMOVED*** WebSocketGatewayOptions — connection-level only
    maxConnections: 1000
    maxSubscriptionsPerClient: 50
    heartbeatIntervalMs: 30000                     ***REMOVED*** default 30000; also drops dead/expired-token sockets
    maxMessageBytes: 16384                          ***REMOVED*** default 16384; oversized client frames dropped
    allowedOrigins: [https://app.example.com]       ***REMOVED*** omit → all Origins accepted (logged)
    ***REMOVED*** auth/roles/scope are declared PER-EVENT on events[], not here

  paths:   [ ... ]                   ***REMOVED*** PathDefinition[] (HTTP routes) — see below
  events:  [ ... ]                   ***REMOVED*** WebSocketEvent[] (WS / webhook) — see below
```

The reload control action is the literal string **`gw-reload`** (`GW_RELOAD_ACTION`); the
control-topic subscriber ignores every other message. Concurrent `reload()`s are coalesced.

***REMOVED******REMOVED******REMOVED*** gateway.paths[]  (PathDefinition — HTTP routes)

```yaml
- name: report-download   ***REMOVED*** logical name (logs + metrics)
  method: GET             ***REMOVED*** GET | POST | PUT | DELETE | PATCH
  path: /reports/:id      ***REMOVED*** Express route, :params merged into payload (params win)
  dataSource: query-body  ***REMOVED*** body | query | params | body-query | query-body
  topic: rlb-gateway-admin
  action: gw-metrics-get
  mode: rpc               ***REMOVED*** rpc | event
  timeout: 15000          ***REMOVED*** rpc only (ms)
  auth: gateway-jwks      ***REMOVED*** auth-provider name
  allowAnonymous: false   ***REMOVED*** true → skip the auth/role gate entirely
  roles: [user, admin]    ***REMOVED*** caller must hold AT LEAST ONE; requires auth + IAclRoleService
  successStatusCode: 200  ***REMOVED*** default 200 rpc / 202 event / 204 empty rpc reply
  binary: true            ***REMOVED*** treat a raw (non-JSON) reply as base64 → binary body
  redirect: 302           ***REMOVED*** rpc only → redirect with this status, using the reply as Location
  parseRaw: false         ***REMOVED*** true → forward raw body as $raw (needs rawBody:true at bootstrap)
  headers: { Cache-Control: no-store }    ***REMOVED*** static response headers
  forwardHeaders: { X-Trace-Id: X-Request-Id }   ***REMOVED*** request header → forwarded (dest prefixed by headerPrefix)
```

dataSource payload composition (`req.params` always merged in, re-applied last so they win):

| value        | payload                          |
| ------------ | -------------------------------- |
| `body`       | `{...params, ...body}`           |
| `query`      | `{...params, ...query}`          |
| `params`     | `{...params}`                    |
| `body-query` | `{...params, ...query, ...body}` |
| `query-body` | `{...params, ...body, ...query}` |

Uploads → `$files` (buffers as binary strings), raw → `$raw`.

**rpc status:** defined reply (incl. falsy `false`/`0`/`""`) → `200` + body; `null`/`undefined`
→ `204`. Error `name` → status: BadRequestError/InvalidParamsErrror→400, UnauthorizedError→401,
ForbiddenError→403, NotFoundError→404, ConflictError→409, else→500.
**event status:** successful publish → `successStatusCode || 202`; publish failure → `503`.

Auth gate (per request): `allowAnonymous:true` → gate skipped; `auth` no `roles` → authn only
(401 if invalid); `auth` + `roles` → authn then in-process `canUserDoGtw(roles, userId)` (403 if
no role). `roles` without `auth` fails closed (every request 403).

***REMOVED******REMOVED******REMOVED*** gateway.events[]  (WebSocketEvent — WS / webhook)

```yaml
- name: chat               ***REMOVED*** clients subscribe to "chat"; messages arrive as onChat
  type: ws                 ***REMOVED*** ws | mqtt (reserved) | http (webhook)
  exchange: rlb            ***REMOVED*** broker source bound to a per-instance exclusive ephemeral queue
  routingKey: chat.messages
  auth: gateway-jwks       ***REMOVED*** provider that verifies the token + maps claims FOR THIS event (at subscribe)
  requireAuth: true        ***REMOVED*** default true when `auth` is set; false → auth optional (anon allowed)
  roles: [user]            ***REMOVED*** ACL check via IAclRoleService (needs auth)
  scopeClaim: userId       ***REMOVED*** per-user isolation: the mapped claim value...
  payloadKey: userId       ***REMOVED*** ...must equal payload[payloadKey]; without payloadKey → denies everything
  ***REMOVED*** type: http only:
  url: https://hooks.example.com/orders
  method: POST
  timeout: 5000
  headers: { Authorization: "Bearer ..." }
```

WS client connects with the JWT in the subprotocol: `new WebSocket(url, [token])` (browsers
can't set handshake headers). A bare value, or `['bearer', '<token>']` / `['jwt', '<token>']`,
is accepted. Token verified per-event at subscribe (memoized per provider per connection);
session bounded by the JWT `exp` (closed `1008` on expiry). Client protocol:
`{action:'subscribe'|'unsubscribe', topic, select?}`; inbound `{ topic:'on<Name>', data }`;
errors `{ topic:'onError', data:{event,error} }` (`unauthorized`, `forbidden`,
`subscription_limit`, `unknown_event`). `select` is a client filter, intersected with — never
bypassing — the server `scopeClaim` isolation. Each instance binds its own exclusive
auto-delete queue, so every instance needs a distinct `connection_name`.

---

***REMOVED******REMOVED*** gateway-admin / ACL HTTP surface (decorator-bound topics + actions)

These are exposed as ordinary `gateway.paths[]` entries forwarding to the fixed topics/actions
below. **Name-keyed** resources have NO POST and no id — `PUT` upserts by `name`.

ACL (topic `rlb-acl`):

| Method | Path | Action |
| --- | --- | --- |
| GET | `/acl/check` | `acl-can-user-do-gtw` (resource-agnostic; `200` true/false) |
| GET | `/acl/check-resource` | `acl-can-user-do` (resource-scoped; `200` true/false) |
| GET | `/acl/resources` | `acl-list-resources-by-user` (auth, reads `X-GTW-AUTH-USERID`) |
| POST | `/acl/grants` | `acl-grant` (`{userId, roles, resourceId?, companyId?}`) |
| DELETE | `/acl/grants` | `acl-revoke` (same shape; `roles` REQUIRED) |
| GET / PUT / DELETE | `/acl/actions[/get?name=]` | `acl-action-list`/`-update`/`-delete`/`-get` |
| GET / PUT / DELETE | `/acl/roles[/get?name=]` | `acl-role-list`/`-update`/`-delete`/`-get` |

Gateway-admin (topic `rlb-gateway-admin`, except reload):

| Method | Path | Action |
| --- | --- | --- |
| GET | `/health` | `gw-health` → `{ status: 'ok' }` |
| POST / GET / PUT / DELETE | `/admin/paths[/export\|/get]` | `gw-path-create`/`-list`/`-export`/`-update`/`-get`/`-delete` (**id-keyed, POST creates**) |
| GET / PUT / DELETE | `/admin/auth[/get?name=]` | `gw-auth-list`/`-update`/`-delete`/`-get` (**name-keyed PUT-upsert**) |
| GET | `/admin/metrics[/series\|/points]` | `gw-metrics-get`/`-series`/`-points` |
| POST | `/admin/metrics/track` | `gw-metrics-track` (`mode: event`) |
| POST | `/admin/reload` | `gw-reload` on `rlb-gateway-control` (`mode: event`) |

> Removed: `acl-list-by-user`, `acl-verify-access`, `gw-auth-create`, all id-based ACL CRUD.
