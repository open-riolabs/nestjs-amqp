***REMOVED*** Gotchas & Troubleshooting

A field guide to the failure modes that actually bite people using `@open-rlb/nestjs-amqp`.
Skim the relevant section before adding or changing a topic, queue, exchange, action, HTTP
route, auth provider, or WebSocket event. Each item is a real trap in the current code, with
the fix.

Related pages: [Broker](./broker.md) · [Gateway](./gateway.md) · [ACL](./acl.md) ·
[Gateway Admin](./gateway-admin.md) · [Getting Started](./getting-started.md).

---

***REMOVED******REMOVED*** Decorators & handlers

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

***REMOVED******REMOVED*** Topic ↔ queue ↔ exchange wiring

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

***REMOVED******REMOVED*** Distinct `connection_name` per broadcast / WebSocket instance

Anything that fans out — the `gw-reload` control topic and WebSocket events — relies on each
process owning a **distinct** AMQP `connection_name` (`clientProperties.connection_name`, or
`broker.routeDiscovery.serviceName`, which fills it in when unset).

If two gateway instances share the same `connection_name`, RabbitMQ treats their per-instance
queues as one logical consumer group and **round-robins** broadcast messages between them.
Symptoms: reloads only land on "every other" instance, and WS clients on one instance miss
events that were delivered to the other. Give every instance a unique name.

A `broadcast` topic with a WebSocket gateway also *requires* `connection_name` to be set
(`clientProperties`) or it throws at startup.

---

***REMOVED******REMOVED*** RPC, timeouts & errors

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

***REMOVED******REMOVED*** Gateway HTTP

**`/acl/check*` (and any boolean RPC) return `200` with `true`/`false`, not `204`.** A *defined*
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

**`/health` is a tiny liveness probe.** It maps to action `gw-health` and returns
`{ status: 'ok' }` — it is **not** a metrics dump. Use `/admin/metrics*` (`gw-metrics-*`) for
metrics.

---

***REMOVED******REMOVED*** Auth & ACL

**`roles` on a path require `auth` on the same path.** The role check needs to identify the
caller; without an `auth` provider it can't, and every request is denied (the gateway logs the
warning and returns `403`). Always pair `roles: [...]` with `auth: <provider>`.

**The gateway role check is name-keyed and OR-based.** `paths[].roles` lists ROLE NAMES; the
caller passes if they hold **at least one** of them (`acl-can-user-do-gtw` →
`canUserDoGtw(roles, userId)`, resource-agnostic). The provider only needs to extract the userId
(`uidClaim` + `headerPrefix`) — no topic/action wiring.

**Two ACL check actions, both cached, inputs are userId + roles only:**

| Action | Helper | Use |
| --- | --- | --- |
| `acl-can-user-do-gtw` | `canUserDoGtw(roles, userId)` | Gateway primary filter — OR, resource-agnostic. Exposed at `GET /acl/check`. |
| `acl-can-user-do` | `canUserDo(roles, userId, resource)` | MS-side, resource-scoped — a global grant OR a grant on that resource passes. Exposed at `GET /acl/check-resource`. |

Both are HTTP **GET** and return `200` + `true`/`false`.

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

**`acl-revoke` now REQUIRES `roles` (just like `acl-grant`).** Both take `userId` + `roles`
(required) and optional `resourceId` + `companyId`. `grant` MERGES the roles into the single
`(userId, resourceId)` record (idempotent — no duplicates). `revoke` REMOVES exactly those roles
and **deletes the record once it has no roles left**. Calling `revoke` without `roles` throws
`400 roles are required` — it does not wipe the grant. To delete a whole grant, revoke all its
roles.

**`companyId` is grouping metadata only.** It replaced the old `resourceBusinessId` and plays
**no part** in authorization decisions — it only groups resources for listings
(`acl-list-resources-by-user`). Don't expect a `companyId` to scope a grant.

**Removed actions.** `acl-list-by-user` and `acl-verify-access` no longer exist. Use
`acl-can-user-do` for resource-scoped checks and `acl-list-resources-by-user` to list a user's
resources.

**Auth & gateway config go to `ProxyModule`, not `BrokerModule`.** Auth-providers and gateway
options are passed as `authOptions` / `gatewayOptions` on `ProxyModule`. `BrokerModule` owns only
`options` / `topics` / `appOptions`.

**Decorator auth is per ROUTE, paired by name — not per-action.** `@BrokerAuth(authName,
allowAnonymous?, roles?, httpName?)` stays DECOUPLED from `@BrokerHTTP(method, path, dataSource,
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
@BrokerAction('booking', 'get-booking')
@BrokerHTTP('GET', '/bookings/:id',       'params', { name: 'get-booking' })
@BrokerAuth('cust-jwks', true, undefined, 'get-booking')
@BrokerHTTP('GET', '/admin/bookings/:id', 'params', { name: 'admin-get-booking' })
@BrokerAuth('admin-jwks', undefined, ['admin'], 'admin-get-booking')
```

---

***REMOVED******REMOVED*** Auth providers (hardening)

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

***REMOVED******REMOVED*** WebSocket

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

---

***REMOVED******REMOVED*** Publish / events

**`publishMessage` is `async` — `await` it.** Awaiting gives you the publisher-confirm guarantee
and surfaces failures. Un-awaited, it's fire-and-forget with no guarantee. (For an `event`-mode
route, the gateway awaits the confirm before returning the `2xx`, so the success status is not
optimistic.)

---

***REMOVED******REMOVED*** Reload & route auto-discovery

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
