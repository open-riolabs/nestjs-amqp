# Gateway (HTTP & WebSocket proxy)

The **gateway** turns your RabbitMQ broker actions into a public surface. It mounts an
Express router that maps HTTP routes to `topic`/`action` pairs (forwarding each call over the
broker and relaying the reply), and a WebSocket server that fans broker events out to connected
clients. Both share one declarative configuration block (`gateway:` in YAML) and one set of
named **auth-providers**.

The gateway is the `ProxyModule`. It is HTTP-transport-agnostic in spirit but ships on Express
(`@nestjs/platform-express`), with a `ws`-based WebSocket layer wired through Nest's `WsAdapter`.

- For the broker primitives the gateway forwards to, see [./broker.md](./broker.md).
- For the admin actions exposed under `/admin/*` (DB-backed routes, auth-providers, metrics,
  route auto-discovery), see [./gateway-admin.md](./gateway-admin.md).
- For action-gated routes and the `acl-check-action` check, see [./acl.md](./acl.md).

## Base features

- **Declarative routes.** Each `gateway.paths[]` entry is a `PathDefinition`: HTTP method + path
  → broker `topic`/`action`, in `rpc` (wait for a reply) or `event` (fire-and-forget) mode.
- **Built-in auth gate.** Per-path `auth` (a named provider) validates the request; `actions`
  add an action-based ACL check (scoped to the request's `(companyId, resourceId)`);
  `allowAnonymous` opts a route out entirely.
- **Claim forwarding.** A valid token's claims are mapped to `X-GTW-AUTH-*` headers and forwarded
  to the microservice — request headers can never override them (anti-spoofing).
- **Runtime reload.** Routes can be pulled from a DB and rebuilt without a restart (see
  `loadConfig.paths` and `reloadTopic`).
- **WebSocket events.** `gateway.events[]` bind broker exchanges to per-user, per-event WS streams
  with token auth, action checks, and per-user scope isolation. `http`-type events forward to a webhook.
- **Per-call metrics.** Every served request is emitted (fire-and-forget) to a broker sink and/or
  an in-process hook.

## NestJS configuration

Register `ProxyModule.forRootAsync(...)`. It owns the gateway's `gatewayOptions`
(the `gateway:` block) and `authOptions` (the `auth-providers:` block), plus any extra DI bindings:

```ts
ProxyModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    authOptions: config.get<HandlerAuthConfig[]>('auth-providers'),
    gatewayOptions: config.get<GatewayConfig>('gateway'),
  }),
  providers: [
    // Required ONLY for action-gated paths/events: lets the gateway run checkAction in-process.
    { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService },
    // Optional: an in-proxy metrics sink (e.g. write each call to InfluxDB).
    { provide: RLB_GTW_METRICS_HOOK, useClass: InfluxMetricsHook },
  ],
})
```

Two bindings live in `providers`:

- **`RLB_GTW_ACL_ROLE_SERVICE`** — an `IAclRoleService` (typically `AclService`). It backs the
  `checkAction` call on any path/event that declares `actions`. The binding is **optional**: if a
  path declares `actions` and this service is **not** registered, the request is **denied (403)**
  and an error is logged. Routes without `actions` work fine without it.
- **`RLB_GTW_METRICS_HOOK`** — an optional `GatewayMetricsHook` (`{ track(point) }`). When present,
  the gateway calls it once per served request, independently of the broker `gateway.metrics` sink.

### `main.ts` requirements

The bootstrap must enable **raw body** (so `parseRaw` paths can read `req.rawBody`) and install the
**WsAdapter** (so the WebSocket layer works). See
[../sample/config-sample/gateway-in-memory/src/main.ts](../sample/config-sample/gateway-in-memory/src/main.ts):

```ts
const app = await NestFactory.create(AppModule, { rawBody: true }); // required for parseRaw
app.useWebSocketAdapter(new WsAdapter(app));                        // required for WebSocket events
app.enableShutdownHooks();
await app.listen(port, host);
```

## YAML: the `gateway:` block

`GatewayConfig` fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `paths` | `PathDefinition[]` | HTTP routes (see below). |
| `events` | `WebSocketEvent[]` | WebSocket / webhook event bindings (see below). |
| `headerPrefix` | `string?` | Prefix applied to **forwarded request headers** (`forwardHeaders`). Note: auth-claim headers use the provider's own `headerPrefix`. |
| `ws` | `WebSocketGatewayOptions?` | Connection-level WS limits & heartbeat. |
| `loadConfig.paths` | `{ topic, action }?` | RPC the gateway calls on (re)load to pull DB-stored routes, merged with the YAML `paths`. |
| `loadConfig.events` | `{ topic, action }?` | RPC called on boot to pull DB-stored WS events, merged with the YAML `events`. |
| `reloadTopic` | `string?` | Broadcast control topic. A message with `action: 'gw-reload'` on this topic rebuilds the route table at runtime. |
| `metrics` | `{ topic, action }?` | Broker sink for per-call metrics (e.g. `{ topic: 'rlb-gateway-admin', action: 'gw-metrics-track' }`). Omit to disable. |

```yaml
gateway:
  headerPrefix: "X-FWD-"
  reloadTopic: rlb-gateway-control
  metrics:
    topic: rlb-gateway-admin
    action: gw-metrics-track
  loadConfig:
    paths:
      topic: rlb-gateway-admin
      action: gw-path-export
  paths: [ ... ]   # see HTTP config
  events: []       # see WebSocket config
```

> The reload control action is the literal string **`gw-reload`** (`GW_RELOAD_ACTION`). The control
> topic in the sample is a `broadcast` topic so **every** gateway instance reloads. The subscriber
> ignores any other message on that topic (e.g. route-discovery traffic) — only `gw-reload` rebuilds
> routes. Calling `reload()` concurrently is safe: overlapping signals are **coalesced** into exactly
> one extra pass.

## HTTP configuration (paths & auth)

### `PathDefinition` fields

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | Logical name (used in logs and metrics). |
| `method` | `string` | HTTP verb (`GET`, `POST`, `PUT`, `DELETE`, …). |
| `path` | `string` | Express route, may include `:params` (e.g. `/users/:id`). |
| `topic` / `action` | `string` | Broker destination this route forwards to. |
| `mode` | `'rpc' \| 'event'` | `rpc` waits for a reply; `event` fire-and-forget with publisher confirm. |
| `dataSource` | see below | How the request payload is assembled. |
| `auth` | `string?` | Name of an auth-provider to validate the request. |
| `allowAnonymous` | `boolean?` | `true` makes the route public (auth/action gate skipped). |
| `actions` | `string \| string[]` | Action names; the caller must hold **at least one** (OR-semantics) on the request's `(companyId, resourceId)`. Requires `auth`. |
| `timeout` | `number?` | RPC timeout (ms) for `rpc` mode. |
| `parseRaw` | `boolean?` | Adds the raw request body as `$raw` (needs `rawBody: true`). |
| `binary` | `boolean?` | Treat a raw (non-JSON) RPC reply as base64 → binary body. |
| `successStatusCode` | `number?` | Override the success status (default 200 rpc / 202 event / 204 empty). |
| `redirect` | `number?` | When set on an `rpc` route, redirect with this status using the reply as the location. |
| `headers` | `{ [k]: ... }` | Static response headers. |
| `forwardHeaders` | `{ [dest]: srcHeader }` | Copy named request headers downstream (prefixed by `gateway.headerPrefix`). |

**`dataSource`** controls what is forwarded as the message payload. `req.params` are always merged
in, plus:

| `dataSource` | Payload |
| --- | --- |
| `body` | `{ ...params, ...body }` |
| `query` | `{ ...params, ...query }` |
| `params` | `{ ...params }` |
| `body-query` | `{ ...params, ...query, ...body }` (body wins) |
| `query-body` | `{ ...params, ...body, ...query }` (query wins) |

Uploaded files (multipart, any field) are attached as `$files` (buffers are converted to binary
strings before forwarding). Multipart bodies are parsed **after** authentication (an anonymous
client cannot make the gateway buffer uploads) and are capped by `gateway.upload`
(`maxFileSizeMb`, default 25; `maxFiles`, default 10) — exceeding a limit returns `413`. Files
are buffered in gateway RAM and re-encoded into the AMQP message (~2-3x the file size), so mind
the broker's `max_message_size` when raising the caps.

### The three-case auth gate

For every request the gateway runs `processAuthData` (best-effort), then decides:

1. **`allowAnonymous: true`** → the gate is **skipped**. A token, if present and valid, still has its
   claims mapped and forwarded; a missing/invalid token is **not** blocked.
2. **`auth` set, no `actions`** → **authentication only**. The provider must validate the request
   (else `401`); on success the mapped claim headers (`X-GTW-AUTH-*`) are forwarded downstream.
3. **`auth` + `actions`** → authentication **and** action-based authorization. After a valid token,
   the gateway resolves the user id from the provider's `uidClaim`, extracts the request's
   `(companyId, resourceId)`, and calls
   `IAclRoleService.checkAction(userId, ctx, actions)` **in-process**. The user passes if they hold
   at least one of `actions` on that **exact** target; otherwise `403`.

> Declaring `actions` **without** `auth` is a misconfiguration — there is no identity to check, so the
> path fails closed (every request `403`). The gateway logs this loudly at boot. Likewise, the action
> check requires a `jwt`/`jwks` provider with a `uidClaim`, and a registered `RLB_GTW_ACL_ROLE_SERVICE`;
> any missing piece → deny.

#### Resource scoping

The action check is **resource-aware**: the caller must hold the action on the **exact**
`(companyId, resourceId)` the request targets — there is no wildcard. A resource-less grant
authorizes **only** a request that also carries no company/resource (both ids absent on the request
**and** the grant). `companyId` is part of the decision, not grouping metadata.

The gateway always reads the canonical `companyId` / `resourceId` from the request, precedence
**params → query → body**, and matches them exactly. Normalization treats `undefined`, `null` and
`''` as *absent* (they compare equal), so a missing canonical field simply means "resource-less"
rather than failing.

There is no separate resource-scoped ACL action: the single `acl-check-action` primitive does both
the gateway gate and any in-service check. See [./acl.md](./acl.md).

### Auth-providers (static config)

`gateway.auth` references a provider by `name` from the top-level `auth-providers:` list
(`HandlerAuthConfig[]`). Fields:

| Field | Applies to | Purpose |
| --- | --- | --- |
| `name` | all | Referenced by `path.auth` / `event.auth`. |
| `type` | all | `jwt`, `jwks`, `basic`, `str-compare`, or `none`. |
| `headerPrefix` | all | Prefix for mapped claim headers (e.g. `X-GTW-AUTH-`). |
| `uidClaim` | jwt/jwks | Claim that becomes the user id header `<headerPrefix>USERID` (required for action checks). |
| `jwtMap` | jwt/jwks | `['source:dest', ...]` — maps decoded claims to `<headerPrefix><DEST>` headers. **Without it, no claims are forwarded** (the token is accepted but nothing is exposed). |
| `algorithms` | jwt/jwks | Allowed signing algorithms (e.g. `[RS256]`). |
| `issuer` | jwt/jwks | Expected token issuer. |
| `secret` | jwt / str-compare | HS secret (jwt) / expected token string (str-compare). |
| `jwksUri` | jwks | JWKS endpoint for key discovery. |
| `clientId` / `clientSecret` | basic | Expected username / password for HTTP Basic. |

Provider behaviour:

- **`jwt` / `jwks`** — verify the `Authorization: Bearer <token>` header, then map claims via `jwtMap`.
- **`basic`** — verify `Authorization: Basic` against `clientId`/`clientSecret`; maps username to
  `<prefix>USERNAME`/`<prefix>USERID`. A `basic` provider **without** `clientSecret` passes through
  as authenticated (open by design).
- **`str-compare`** — compares the raw `Authorization` header to `secret`; maps it to `<prefix>TOKEN`.
  Without `secret`, passes through as authenticated.

```yaml
auth-providers:
  - name: gateway-jwks
    type: jwks
    headerPrefix: "X-GTW-AUTH-"
    uidClaim: USERID
    jwtMap:
      - sub:userId
      - email:email
      - preferred_username:username
      - roles:roles
    algorithms: [RS256]
    issuer: https://login.example.net/realms/dev
    jwksUri: https://login.example.net/realms/dev/protocol/openid-connect/certs
    clientId: my-app
```

### Response & error → HTTP status mapping

For **`rpc`** routes:

| Reply | Status |
| --- | --- |
| Defined value (incl. falsy `false` / `0` / `''`) | `200` + JSON/raw body |
| `null` / `undefined` | `204 No Content` |

> A **defined falsy** result is real content, so a boolean check route (e.g. `GET /acl/check`)
> answers `200` with body `false` — **not** an empty `204`. Only `null`/`undefined` collapses to `204`.

When `mode: rpc` and the broker reply rejects, the error `name` maps to a status:

| Error name | Status |
| --- | --- |
| `BadRequestError`, `InvalidParamsErrror` | `400` |
| `UnauthorizedError` | `401` |
| `ForbiddenError` | `403` |
| `NotFoundError` | `404` |
| `ConflictError` | `409` |
| (any other) | `500` |

For **`event`** routes: a successful publish returns `successStatusCode || 202`; a publish failure
returns `503`.

#### Unified error envelope

**Every** gateway error response — across the whole HTTP surface — shares one shape:

```json
{ "statusCode": 403, "code": "ForbiddenError", "message": "...", "details": "..." }
```

- `statusCode` — the HTTP status (mapped from the error `name` as above).
- `code` — the error `name` (e.g. `ForbiddenError`, `NotFoundError`).
- `message` — the error message.
- `details` — the stack, **included only outside production** (omitted when `NODE_ENV=production`).

This applies to **the auth gate too**: the `401`/`403` replies from the built-in auth/action gate
now use this envelope (previously a bare `{ message: 'Unauthorized' }`). One shape for the whole
HTTP surface — broker-reply errors and gate rejections alike.

### Metrics hook

When `gateway.metrics` and/or a `RLB_GTW_METRICS_HOOK` are present, the gateway emits one
`GatewayMetricPoint` per served request **after** the response is flushed
(`ts, method, route, name, topic, action, mode, status, durationMs`). It is fire-and-forget: it
never throws and never delays the response. The broker sink feeds the gateway-admin metrics handler;
the in-proxy hook (e.g. an InfluxDB writer) runs independently. See [./gateway-admin.md](./gateway-admin.md).

## WebSocket configuration

WebSocket streams are declared in `gateway.events[]`. Each `WebSocketEvent` binds a broker exchange
to a named client-facing event. Connection-level limits live in `gateway.ws`.

### `WebSocketEvent` fields

| Field | Type | Purpose |
| --- | --- | --- |
| `type` | `'ws' \| 'mqtt' \| 'http'` | `ws` = client stream; `http` = forward each message to a webhook. |
| `name` | `string` | Event name. Clients subscribe by this name; messages arrive as `on<Name>`. |
| `exchange` / `routingKey` | `string` | Broker source bound to a per-instance exclusive queue. |
| `auth` | `string?` | Auth-provider used to verify the connection token **and** map claims, at subscribe time. When set, a valid token is required unless `requireAuth: false`. |
| `requireAuth` | `boolean?` | `false` makes `auth` optional (anonymous may subscribe; authenticated still get claims). Defaults `true` when `auth` is set. |
| `actions` | `string \| string[]?` | Action names checked via the ACL service (needs `auth`); OR-semantics. Checked **resource-agnostically** — WS events carry no HTTP resource. |
| `scopeClaim` | `string?` | Per-user isolation: the claim whose value must match the message. |
| `payloadKey` | `string?` | The message payload key compared against `scopeClaim`. |
| `url` / `method` / `headers` / `timeout` | — | For `type: 'http'` events: the webhook target. |

### `WebSocketGatewayOptions` (`gateway.ws`) fields

| Field | Default | Purpose |
| --- | --- | --- |
| `maxConnections` | — | Max concurrent connections this instance accepts. |
| `maxSubscriptionsPerClient` | — | Max active subscriptions per client. |
| `heartbeatIntervalMs` | `30000` | Ping/pong heartbeat (also drops dead sockets and expired-token sessions). |
| `allowedOrigins` | — | Allowlist of accepted `Origin` headers. When unset, all origins are accepted (logged at boot). |
| `maxMessageBytes` | `16384` | Max inbound client message size; larger frames are dropped. |
| `maxBufferedBytes` | `1048576` | Outbound backpressure cap: when a client's send buffer exceeds this, its event messages are **dropped** until it drains (a slow-but-alive client can no longer grow gateway memory unbounded). |

> Authentication/authorization is declared **per-event** (`auth`/`requireAuth`/`actions`/`scopeClaim`),
> not in `gateway.ws`.

### How it works

- **Token in subprotocol.** The connection token is read from `Sec-WebSocket-Protocol`
  (set via the second argument of the browser `WebSocket` constructor). A single value is the token;
  a `['bearer', '<token>']` / `['jwt', '<token>']` pair is also accepted. The token is verified
  **per-event** at subscribe time with that event's provider, and the session lifetime is bounded by
  the token's `exp` (expired sessions are closed by the heartbeat).
- **Per-event auth & actions.** On `subscribe`, if the event has `auth` the token is verified and
  claims mapped; `requireAuth !== false` rejects an invalid token (`onError: 'unauthorized'`). If it
  has `actions`, `checkActionsForClaims` runs against the ACL service resource-agnostically
  (`onError: 'forbidden'`).
- **Per-user scope isolation.** With `scopeClaim` + `payloadKey`, the server only forwards messages
  whose `payload[payloadKey]` equals the authenticated client's `scopeClaim` value. This prevents a
  client from receiving other users' data via a crafted `select` filter. With `auth` but **no**
  `scopeClaim`/`payloadKey`, every authorized subscriber receives **all** messages (warned at boot).
- **Multi-instance fan-out.** Each gateway instance binds the event's exchange to its **own
  ephemeral, exclusive, auto-delete** queue (`<name>-ws-<conn>-<pid>-<rand>`). Every instance
  receives every event and forwards it to the clients connected to it. (Each instance needs a distinct
  broker `connection_name`.)
- **`http` events.** `type: 'http'` events forward each broker message to `url`/`method` instead of
  to WS clients.

## WebSocket client protocol & example

A client opens one WebSocket and **multiplexes** many topics over it. The wire protocol is JSON:

- **Subscribe:** `{ action: 'subscribe', topic: '<name>', select?: { ... } }`
- **Unsubscribe:** `{ action: 'unsubscribe', topic: '<name>' }`
- **Inbound message:** `{ topic: 'on<Name>', data: <payload> }`
  (`<Name>` is the event `name` with its first letter capitalized — `chat` → `onChat`).
- **Errors:** `{ topic: 'onError', data: { event, error } }` (e.g. `unauthorized`, `forbidden`,
  `subscription_limit`, `unknown_event`).

The `select` object is a client-side filter: the server only forwards messages whose
`payload[key] === select[key]` for every key — **intersected** with the server-enforced `scopeClaim`
isolation (which a `select` cannot bypass).

The reference client uses RxJS `webSocket()` plus `share()` so all topic observables ride a single
socket; each topic filters on its `on<Topic>` envelope:

```js
const { webSocket } = rxjs.webSocket;
const { filter, map, share } = rxjs.operators;

const TOKEN = ''; // e.g. 'eyJhbGciOi...'; carried in the subprotocol
const wsSubject = webSocket({
  url: 'ws://localhost:3000',
  protocol: TOKEN ? [TOKEN] : undefined,   // token in Sec-WebSocket-Protocol
});
const sharedMessages$ = wsSubject.pipe(share());   // one socket, many topics

function getTopicObservable(topic) {
  const onTopic = `on${topic.charAt(0).toUpperCase() + topic.slice(1)}`;
  return sharedMessages$.pipe(filter(m => m.topic === onTopic), map(m => m.data));
}

// subscribe
getTopicObservable('chat').subscribe(data => console.log(data));
wsSubject.next({ action: 'subscribe', topic: 'chat' });

// unsubscribe
wsSubject.next({ action: 'unsubscribe', topic: 'chat' });
```

See the full runnable page at [../web-socket-sample.html](../web-socket-sample.html) and the
bootstrap wiring at [../sample/config-sample/gateway-in-memory/src/main.ts](../sample/config-sample/gateway-in-memory/src/main.ts).

## Reference: sample routes

The demo gateway ([../sample/config-sample/gateway-in-memory/config/config.yaml](../sample/config-sample/gateway-in-memory/config/config.yaml))
exposes, among others:

| Method & path | Topic | Action | Mode | Notes |
| --- | --- | --- | --- | --- |
| `GET /health` | `rlb-gateway-admin` | `gw-health` | rpc | Readiness probe → `{ status, broker, dependencies }` (`up`/`down`); always HTTP 200. See [gateway-admin](./gateway-admin.md#health--gw-health-readiness-probe). |
| `GET /acl/check` | `rlb-acl` | `acl-check-action` | rpc | `?userId=&action=&companyId=&resourceId=` → `200 true/false`. |
| `PUT /acl/actions` | `rlb-acl` | `acl-action-update` | rpc | name-keyed upsert. |
| `PUT /acl/roles` | `rlb-acl` | `acl-role-update` | rpc | name-keyed upsert. |
| `POST /acl/grants` | `rlb-acl` | `acl-grant` | rpc | `{ userId, roles, resourceId?, companyId? }`; gated by `role-management` on the target. |
| `DELETE /acl/grants` | `rlb-acl` | `acl-revoke` | rpc | same shape; removes roles; same gate. |
| `PUT /admin/auth` | `rlb-gateway-admin` | `gw-auth-update` | rpc | name-keyed auth-provider upsert. |
| `POST /admin/reload` | `rlb-gateway-control` | `gw-reload` | event | broadcasts a route reload. |
| `GET /protected` | `rlb-gateway-admin` | `gw-metrics-get` | rpc | `auth: gateway-jwks`, `actions: [read-metrics]`. |

> The topic names `rlb-acl` / `rlb-gateway-admin` and all action strings shown here are
> **decorator-bound** on the backend and are **not** configurable — they must match the handler
> decorators exactly. See [./acl.md](./acl.md) and [./gateway-admin.md](./gateway-admin.md).

---

[← Back to index](./README.md)
