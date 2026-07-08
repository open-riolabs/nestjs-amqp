# Gotchas & Troubleshooting

A field guide to the failure modes that actually bite people using `@open-rlb/nestjs-amqp`.
Skim the relevant section before adding or changing a topic, queue, exchange, action, HTTP
route, auth provider, or WebSocket event. Each item is a real trap in the current code, with
the fix.

Related pages: [Broker](./broker.md) · [Gateway](./gateway.md) · [ACL](./acl.md) ·
[Gateway Admin](./gateway-admin.md) · [Getting Started](./getting-started.md).

---

## Decorators & handlers

**Don't destructure `@BrokerAction` parameters.** The parameter-to-message mapping parses the
function source with a regex (`getParamNames`). A signature like `fn({ a, b })` misaligns the
indices and your params arrive `undefined`. Use flat parameters and an explicit `@BrokerParam`
name on each:

```ts
// GOOD
@BrokerAction(MY_TOPIC, 'do-thing', 'rpc')
async doThing(
  @BrokerParam('body', 'userId') userId: string,
  @BrokerParam('body', 'name') name: string,
) { /* ... */ }

// BAD — destructuring breaks index mapping
async doThing(@BrokerParam('body') { userId, name }) { /* ... */ }
```

**Avoid default parameter values.** Only a basic `= value` strip exists
(`removeDefaultsFromParams`); anything more complex misaligns the mapping. Always pass an
explicit `name` to `@BrokerParam` rather than relying on defaults.

**`(topic, action)` must be unique.** Every `@BrokerAction` on a topic shares ONE consumer
queue and is dispatched by its `action` string. A duplicate `(topic, action)` silently
overwrites the previous handler — no error, the old one just stops being called.

**Forwarded headers are UPPERCASE and prefixed.** Identity injected by the gateway arrives as
`X-GTW-AUTH-USERID`, not `userId`. Read it with
`@BrokerParam('header', 'X-GTW-AUTH-USERID')`. (The exact name comes from the provider's
`headerPrefix` + `uidClaim`.)

**`handle`/`broadcast` handlers must return `void`.** Returning a value logs
`Subscribe handlers should only return void`. Only `rpc` handlers return data.

---

## Topic ↔ queue ↔ exchange wiring

**The topic `name` must match everywhere.** The same string ties together the `@BrokerAction`
decorator, `topics[].name`, `requestData`/`publishMessage` calls, and
`gateway.paths[].topic` / `gateway.events[]`. A typo yields
`Topic X not found in configuration`.

**`mode: rpc`/`handle` need a backing queue and exchange.** The topic's `queue` must exist in
`broker.queues[]`, and that queue's `exchange` must exist in `broker.exchanges[]`. With `handle`
a missing queue throws an NPE at boot (`queue.exchange`).

**`type: topic` exchanges require a `routingKey` on the queue.** Otherwise boot throws
`Queue ... has no routing key`. (The sample config uses a `direct` exchange with matching
`routingKey`s.)

**The gateway can only forward to topics it declares.** A microservice that announces its
routes via route-discovery does NOT teach the gateway how to reach its broker topic. The
gateway forwards each request over the broker using `paths[].topic`, so that topic (and its
queue/exchange) must exist in the **gateway's own** `broker` config. If a discovered route
points at a topic the gateway never declared, the request fails with
`Topic ... not found in configuration`. Add the microservice's topic to the gateway config too.

---

## Distinct `connection_name` per broadcast / WebSocket instance

Anything that fans out — the `gw-reload` control topic and WebSocket events — relies on each
process owning a **distinct** AMQP `connection_name` (`clientProperties.connection_name`, or
`broker.routeDiscovery.serviceName`, which fills it in when unset).

If two gateway instances share the same `connection_name`, RabbitMQ treats their per-instance
queues as one logical consumer group and **round-robins** broadcast messages between them.
Symptoms: reloads only land on "every other" instance, and WS clients on one instance miss
events that were delivered to the other.

The library now treats the configured name as a **logical** name and automatically appends a
per-instance `-<hostname>-<pid>` suffix (hostname is unique per container/pod; pid covers
multiple processes on one host — under Docker pid is always 1, so hostname carries the
uniqueness). You can therefore ship the same config to every replica. Auto-created broadcast
queues are `autoDelete` so a retired instance's queue doesn't linger and accumulate messages.

A `broadcast` topic with a WebSocket gateway also *requires* `connection_name` to be set
(`clientProperties`) or it throws at startup.

---

## RPC, timeouts & errors

**Nothing bounds queue growth unless you configure it.** Work queues without
`messageTtl`/`maxLength` grow unbounded when producers outpace consumers, until RabbitMQ's
memory/disk alarms **block every publisher** (freezing gateway `event` paths too). Set bounds in
`queues[].options` — but beware: changing options on an **existing** queue makes the re-declare
fail with `406 PRECONDITION_FAILED` in a loop; delete the queue first or use a broker-side
policy. High-volume droppable traffic (e.g. `gw-metrics-track`) belongs on its **own queue**:
declare the optional `rlb-gateway-metrics` topic and point `gateway.metrics.topic` at it, or a
slow metrics DB will starve `gw-health`/`gw-reload`/admin RPCs on the shared admin queue.

**Failed handlers no longer requeue forever.** The old implicit default (infinite immediate
nack-requeue) hot-looped poison messages. Handler failures now follow a bounded retry policy —
`broker.retry` / `topics[].retry` (`maxAttempts`, `delayMs`, `onExhausted: dead-letter|drop`),
built-in default 5 attempts → drop. Exhausted RPC messages send an error reply
(`RetryExhaustedError` → HTTP 502 at the gateway); deserialization/validation failures skip
retries entirely. Explicitly configured legacy `errorBehavior` values still win. See
[broker.md](./broker.md#retry-policy-brokerretry--topicsretry).

**Wrong `replyQueues` key → silent timeout.** `requestData` resolves `replyTo` from
`broker.replyQueues[exchange]`; when absent it falls back to RabbitMQ direct-reply-to. A wrong
exchange key means no reply is ever routed back, and the call just times out.

**Handler exceptions don't crash the consumer.** A thrown error is returned to the caller as
`{ success: false, error }`, and `requestData` re-throws it on the caller side. The gateway maps
the HTTP status from `error.name` (see below), so give your errors a meaningful `name`
(`BadRequestError`, `NotFoundError`, `ConflictError`, `ForbiddenError`, `UnauthorizedError`, …);
anything unrecognized becomes a generic 500.

**Default RPC timeout is 10s.** Override globally with `broker.defaultRpcTimeout`, or per route
with `paths[].timeout`, or per call with the `timeout` argument to `requestData`. Slow RPCs
otherwise fail with a timeout while the handler is still working.

---

## Gateway HTTP

**`/acl/check` (and any boolean RPC) returns `200` with `true`/`false`, not `204`.** A *defined*
result is real content — including the falsy `false`, `0`, or `""` — so it is sent as
`200` + JSON body. Only `null`/`undefined` becomes `204 No Content`. So
`GET /acl/check?...` answers `200 false` for "no", **not** an empty `204`. Don't treat a 2xx as
"allowed"; read the body.

**`parseRaw: true` needs the raw body enabled at bootstrap.** Create the app with
`NestFactory.create(AppModule, { rawBody: true })`, otherwise `$raw` is `undefined`.

**Route params win over body/query.** Express route params are merged in *last*, so on a key
collision (`:id` vs `body.id`) the URL param overwrites the payload value. Avoid clashing names.

**Uploads live in `$files`.** Multer's `.any()` collects them, and each file's buffer is
converted to a **binary string** before forwarding. Re-encode carefully on the consumer side
(e.g. `Buffer.from(str, 'binary')`).

**`/health` is a readiness probe, and always returns HTTP 200.** It maps to action `gw-health`
and returns `{ status: 'up'|'down', broker: {...}, dependencies: {...} }` — `status` is `'down'`
if the broker OR any dependency is down. The broker (AmqpConnection) is checked built-in; DB/redis/
external checks are **consumer-supplied** via the `RLB_GW_HEALTH_INDICATORS` token (an array of
`GatewayHealthIndicator { name; check() }`). The HTTP response is **always 200** (the gateway
forwards an rpc result and can't set 503), so readiness must inspect the `status` field, not the
HTTP status. It is **not** a metrics dump — use `/admin/metrics*` (`gw-metrics-*`) for metrics.

**Search responses are PAGINATED, not arrays.** Every `*-search` action — `acl-action-search`,
`acl-role-search`, `acl-grant-search`, `gw-path-search`, `gw-auth-search` — now returns a
`PaginationModel<T>` (`{ page, limit, total, data }`) and accepts `?q=&page=&limit=`. The rows live
under `.data`. The `Repository.search(q?, page?, limit?)` contract changed to return
`Promise<PaginationModel<T>>` — don't iterate the response as a bare array.

**Every gateway error response shares ONE envelope.** All errors across the HTTP surface are
`{ statusCode, code, message, details? }` — `code` is the error `name`, `details` is the stack
(included **only outside production**). This includes the **401/403 auth-gate replies** (previously
`{ message: 'Unauthorized' }`). Parse errors by `code`/`statusCode`, not by ad-hoc message shapes.

**Retention prunes the journal + raw metric points after `retentionDays` (default 90 ≈ 3 months).**
A daily `GatewayRetentionService` job deletes route-journal rows AND raw metric points older than
the window via `RouteSyncLogRepository.prune` / `HttpMetricRepository.prunePoints`. Set
`GatewayAdminModuleOptions.retentionDays` to `0`/negative to disable. Counters and time-series
aggregates are not pruned — only the raw points.

**Consumer repos must implement the new contract methods.** Beyond the now-paginated
`search(q?, page?, limit?): Promise<PaginationModel<T>>`, gateway-admin repos gained:
`RouteSyncLogRepository.query(filter, page?, limit?)` (backs the filtered `gw-route-log-search`),
`RouteSyncLogRepository.prune(olderThanTs)`, and `HttpMetricRepository.prunePoints(olderThanTs)`
(both for retention). A consumer that doesn't add them won't satisfy the interface / will break at
runtime.

---

## Auth & ACL

**Route gating uses `actions`, not `roles`; `@BrokerAuth`'s 3rd param is `actions`.** The
gateway gates paths and WS events on ACTION names (`paths[].actions` / `events[].actions`),
not role names. The decorator signature is now
`@BrokerAuth(authName, allowAnonymous?, actions?, httpName?)` — the 3rd arg is `actions`
(was `roles`). Grants still assign ROLES (which bundle actions); only the gating fields and
the check changed. Don't pass role names where the gate expects actions.

**`actions` on a path require `auth` on the same path.** The action check needs to identify the
caller; without an `auth` provider it can't, and every request is denied (the gateway logs the
warning and returns `403`). Always pair `actions: [...]` with `auth: <provider>`.

**The gateway action check is OR-based and resource-aware.** `paths[].actions` lists ACTION
NAMES; the caller passes if they hold **at least one** of them on the request's exact
`(companyId, resourceId)` (`acl-check-action` → `checkAction(userId, ctx, actions)`). The
provider must extract the userId (`uidClaim` + `headerPrefix`). WS events check `actions`
**resource-agnostically** (they carry no HTTP resource).

**The gateway gate verifies `(companyId, resourceId)` EXACTLY — no wildcard.** A grant
authorizes only when its `(companyId, resourceId)` equal the request's (`undefined`/`null`/`''`
all = absent and compare equal). The gateway reads the canonical `companyId`/`resourceId` from
the request (precedence params → query → body) and matches them exactly. Holding the
action on company A / resource X does **not** authorize a request targeting company B or
resource Y.

**Resource-less grants are NO LONGER a wildcard.** A grant with no `companyId`/`resourceId`
authorizes **only** a request that also carries neither (the single carve-out: both ids absent
on request AND grant). It does **not** authorize a request that targets some
`(companyId, resourceId)`. Scope your grants to the exact target you mean to allow.

**One ACL check action — `acl-check-action`, cached.** There is a single primitive now:

| Action | Helper | Use |
| --- | --- | --- |
| `acl-check-action` | `checkAction(userId, ctx, action)` | The only authorization check — OR over `action`, scoped to the exact `(companyId, resourceId)` in `ctx` (pass `ctx === undefined` to skip scoping). Exposed at `GET /acl/check` (query `userId`, `action`, `companyId?`, `resourceId?`). |

It is HTTP **GET** and returns `200` + `true`/`false`. The old `acl-can-user-do` /
`acl-can-user-do-gtw` actions and the second `/acl/check-resource` route are gone.

**Actions, roles and auth-providers are NAME-KEYED. PUT upserts; there is NO POST.** The `name`
*is* the key (no separate id). Create-or-update with `PUT`, list with `GET`, read one with
`GET .../get?name=`, delete by `name`. The old id-based CRUD and `POST`-create endpoints are
gone.

| Resource | List | Get one | Upsert | Delete |
| --- | --- | --- | --- | --- |
| ACL actions | `GET /acl/actions` | `GET /acl/actions/get?name=` | `PUT /acl/actions` | `DELETE /acl/actions` |
| ACL roles | `GET /acl/roles` | `GET /acl/roles/get?name=` | `PUT /acl/roles` | `DELETE /acl/roles` |
| Auth providers | `GET /admin/auth` | `GET /admin/auth/get?name=` | `PUT /admin/auth` | `DELETE /admin/auth` |

(Action strings: `acl-action-*`, `acl-role-*`, `gw-auth-*`. Auth-provider CRUD lives in
**gateway-admin**, not the broker module.)

**`acl-revoke` REQUIRES `roles` (just like `acl-grant`).** Both take `userId` + `roles`
(required) and optional `resourceId` + `companyId`. `grant` MERGES the roles into the single
`(userId, companyId, resourceId)` record (idempotent — no duplicates). `revoke` REMOVES exactly
those roles and **deletes the record once it has no roles left**. Calling `revoke` without `roles`
throws `400 roles are required` — it does not wipe the grant. To delete a whole grant, revoke all
its roles.

**Grant identity is `(userId, companyId, resourceId)`.** There is exactly one grant record per
triple, and the data-plane param is still `roles` (grants assign roles; roles bundle actions).
`companyId` and `resourceId` are part of the key — absent ids (`undefined`/`null`/`''`) compare
equal, so the resource-less grant is its own slot. Two grants for the same user on different
companies/resources are distinct records.

**`grant`/`revoke` need `role-management` ON THE TARGET (seed the first admin).** Both are gated:
the caller — the forwarded `X-GTW-AUTH-USERID` — must hold the `role-management` action on the
**target** `(companyId, resourceId)` being granted/revoked, checked with the same exact-match
`checkAction`; otherwise `403` (`ForbiddenError`). An admin scoped to one company/resource cannot
touch another. The gate action defaults to `role-management` (overridable via
`AclModuleOptions.roleManagementAction`). Since the gate is itself a grant, **bootstrap the very
first `role-management` grant by seeding the grant store directly** — the library adds no bypass.

**`companyId` is LOAD-BEARING in authorization.** It replaced the old `resourceBusinessId` and is
**part of the authorization decision** (and the grant identity) — a grant matches a request only
when both `companyId` and `resourceId` match exactly. It is no longer grouping-only metadata
(though it is still also used to group `acl-list-resources-by-user` results). Don't assume a
mismatched or absent `companyId` is ignored.

**Removed actions.** `acl-can-user-do`, `acl-can-user-do-gtw`, `acl-list-by-user` and
`acl-verify-access` no longer exist. Use `acl-check-action` for every authorization check and
`acl-list-resources-by-user` to list a user's resources.

**Auth & gateway config go to `ProxyModule`, not `BrokerModule`.** Auth-providers and gateway
options are passed as `authOptions` / `gatewayOptions` on `ProxyModule`. `BrokerModule` owns only
`options` / `topics` / `appOptions`.

**Decorator auth is per ROUTE, paired by name — not per-action.** `@BrokerAuth(authName,
allowAnonymous?, actions?, httpName?)` stays DECOUPLED from `@BrokerHTTP(method, path, dataSource,
{ name? })`: it pairs to a specific route by `httpName` === that route's `name`. A method with a
SINGLE `@BrokerHTTP` auto-pairs — no `name`/`httpName` needed. A method with MULTIPLE `@BrokerHTTP`
REQUIRES each route to set `name` and each `@BrokerAuth` to set a matching `httpName`; an
`@BrokerAuth` whose `httpName` is missing or matches no route is NOT applied and logs a **warning at
microservice startup**, leaving that route PUBLIC. Two HTTP paths for the SAME action can now carry
DIFFERENT auth — pair each to its route by name. (`@BrokerAuth`'s 4th arg is `httpName`, a route
name; it is no longer an `action`. The `@BrokerHTTP`↔`@BrokerAction` pairing is separate and
unchanged: `@BrokerHTTP`'s `action` option disambiguates when a method declares multiple
`@BrokerAction`.)

```ts
// Two routes, same action, different auth — each auth pairs by route name.
// (3rd @BrokerAuth arg is `actions`: the admin route requires the `read-booking` action.)
@BrokerAction('booking', 'get-booking')
@BrokerHTTP('GET', '/bookings/:id',       'params', { name: 'get-booking' })
@BrokerAuth('cust-jwks', true, undefined, 'get-booking')
@BrokerHTTP('GET', '/admin/bookings/:id', 'params', { name: 'admin-get-booking' })
@BrokerAuth('admin-jwks', undefined, ['read-booking'], 'admin-get-booking')
```

---

## Auth providers (hardening)

**JWKS verifies TLS by default.** Set `httpsAllowUnauthorized: true` only for self-signed dev
issuers.

**`algorithms` is REQUIRED for `jwt`/`jwks`.** Omitting it denies verification (an
algorithm-confusion guard). For `jwks` only asymmetric algorithms are accepted
(`RS*`/`ES*`/`PS*`); `HS*` and `none` are rejected.

**Define `jwtMap` or NO claims are forwarded.** Without it the token is still accepted
(`success: true`) but the gateway forwards no identity headers — it fails safe rather than
leaking the whole payload. Declare `jwtMap` to emit `X-GTW-AUTH-USERID` and friends.

**`str-compare`/`basic` PASS THROUGH when their secret is unset — by design.** A `str-compare`
with no `secret`, or a `basic` with no `clientSecret`, authenticates *every* request (the
provider is effectively open/disabled). Set the secret to actually enforce it.

**Credential `mechanism` must be `PLAIN` | `EXTERNAL` | `AMQPLAIN`** (case-insensitive). An
unknown value leaves the SASL `response` unset and AMQP auth fails.

---

## WebSocket

**Auth is per-event, not global.** `gateway.events[].auth` names the provider that verifies the
connection token AND maps its claims for *that* event (memoized per provider at subscribe time).
`gateway.ws` only carries connection-level limits/heartbeat — it has no auth fields.

**`scopeClaim` references the MAPPED claim, not the raw token claim.** Use the prefixed name
(e.g. `X-GTW-AUTH-USERID`). `payloadKey` is the event-payload field compared against it.
**`scopeClaim` without `payloadKey` denies everything** (safe default — don't be surprised by an
empty stream). `requireAuth: false` makes `auth` optional (anonymous allowed; claims mapped if a
token is present).

**The token rides in the WebSocket subprotocol.** Connect with `new WebSocket(url, [token])` —
browsers can't set custom handshake headers. The session is bounded by the JWT `exp`: the socket
is closed with code `1008` when the token expires and nothing is delivered afterward. Long-lived
clients need token refresh + reconnect.

**Don't bind a WS event to a fixed durable queue.** The library creates a per-instance,
exclusive, ephemeral queue for fan-out. A shared/durable queue makes instances *compete* for
messages, so clients on one instance miss events delivered to another.

**Set `gateway.ws.allowedOrigins`.** If omitted, ALL Origins are accepted (logged at boot).
`maxMessageBytes` (default 16384) drops oversized client frames.

**Slow WS clients don't grow gateway memory anymore.** `maxBufferedBytes` (default 1 MiB) caps
the outbound send buffer per client: above it, that client's event messages are dropped until it
drains (logged on the saturate/drain transitions). Push semantics are best-effort by design —
size the cap to message size × tolerable burst if clients must survive short stalls.

**A down events source no longer kills the gateway at boot.** `gateway.loadConfig.events`
failures degrade to YAML-only events with a warning; remote events stay missing until a restart
(unlike HTTP routes, WS events have no runtime reload).

---

## Publish / events

**`publishMessage` is `async` — `await` it.** Awaiting gives you the publisher-confirm guarantee
and surfaces failures. Un-awaited, it's fire-and-forget with no guarantee. (For an `event`-mode
route, the gateway awaits the confirm before returning the `2xx`, so the success status is not
optimistic.)

---

## Reload & route auto-discovery

**The only reload action is `gw-reload`.** The control-topic subscriber rebuilds routes ONLY for
action `gw-reload` (`GW_RELOAD_ACTION`); every other message on the control topic is ignored. So
seeding the DB then triggering a reload means: `POST /admin/paths` → `POST /admin/reload` (which
publishes `gw-reload` on `rlb-gateway-control`). No restart needed.

**Concurrent reloads are coalesced.** `reload()` serializes itself: while one rebuild is in
flight, extra signals set a pending flag that triggers exactly one more pass. You won't get
overlapping rebuilds (this fixed the old "reloads every other time" flakiness).

**Route-discovery config is SPLIT, and the exchange/queue MUST match on both sides.**

- **Publisher (microservice):** `broker.routeDiscovery { serviceName, publishOnBoot, exchange?, queue? }`.
  `serviceName` is required to publish and also fills `connection_name` when unset.
- **Consumer (gateway):** `GatewayAdminModule` `routeDiscovery { exchange?, queue? }` (no
  `serviceName` — the gateway only receives).

Both default to `exchange: 'rlb-route-discovery'` (`ROUTE_DISCOVERY_EXCHANGE`) and
`queue: 'rlb-route-sync'` (`ROUTE_SYNC_QUEUE`). They are configurable to namespace per
environment, but the SAME values must be set on **both** sides or manifests never reach the
gateway. The topic names `rlb-acl` / `rlb-gateway-admin` and all action strings are
decorator-bound and **not** configurable.

---

[← Back to index](./README.md)
