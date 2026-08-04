# Gotchas — bug-prone cases checklist

Scan this before adding/changing a topic, queue, exchange, action, route, auth provider,
WS event, or route-discovery wiring. Each item is a real failure mode in this codebase.
Ported from `docs/gotchas.md` (re-verified against post-2.0.5 code).

## Decorators & handlers
1. **No destructuring in `@BrokerAction` parameters.** Param→message mapping parses the
   function source with a regex (`getParamNames`). `fn({a,b})` misaligns indices → params
   arrive `undefined`. Use flat params + an explicit `@BrokerParam` name on each.
2. **Avoid default parameter values.** Only a basic `= value` strip exists
   (`removeDefaultsFromParams`); complex defaults misalign mapping. Always pass an explicit
   `name` to `@BrokerParam`.
3. **`(topic, action)` must be unique.** All `@BrokerAction` of a topic share ONE consumer/queue,
   dispatched by `action`. A duplicate `(topic, action)` overwrites the previous one silently —
   no error, the old handler just stops being called.
4. **Forwarded headers are UPPERCASE + prefixed.** Read `@BrokerParam('header',
   'X-GTW-AUTH-USERID')`, not `'userId'`. The exact name = provider `headerPrefix` + `uidClaim`.
5. **`handle`/`broadcast` handlers must return `void`.** A return value logs
   `Subscribe handlers should only return void`. Only `rpc` handlers return data.
6. **Two independent pairings on a method — `action` (http↔action) and `httpName` (auth↔route).**
   Decorator order is never used; pair by name.
   - **`@BrokerHTTP` ↔ `@BrokerAction`** via the `action` option: a method with multiple
     `@BrokerAction`s requires each `@BrokerHTTP` to name its `action`; with one action it defaults.
   - **`@BrokerAuth` ↔ `@BrokerHTTP` route** via `httpName` (= the route's `name`): auth is
     **per ROUTE**, kept DECOUPLED from `@BrokerHTTP` (which carries NO auth). One `@BrokerHTTP`
     auto-pairs its `@BrokerAuth` (no `name`/`httpName` needed); multiple `@BrokerHTTP` require each
     to set a `name` and each `@BrokerAuth` to set the matching `httpName`. An `@BrokerAuth` whose
     `httpName` matches no route is NOT applied and logs a WARNING at microservice startup.
   - A route with no paired `@BrokerAuth` is **PUBLIC**. Two HTTP paths for the SAME action can now
     carry DIFFERENT auth — pair each to its route by `name`.

## Topic ↔ queue ↔ exchange wiring
7. **The topic `name` must match everywhere**: `@BrokerAction`, `topics[].name`,
   `requestData`/`publishMessage`, `gateway.paths[].topic` / `events[]`. Typo →
   `Topic X not found in configuration`.
8. **`mode: rpc`/`handle` need `topics[].queue` in `broker.queues[]`**, and that queue's
   `exchange` in `broker.exchanges[]`. In `handle` a missing queue throws NPE at boot
   (`queue.exchange`).
9. **Exchange `type: topic` → queue MUST have `routingKey`**, else boot throws
   `Queue ... has no routing key`. (The samples use a `direct` exchange with matching keys.)
10. **The gateway can only forward to topics it declares.** Route auto-discovery teaches the
    gateway the HTTP route, NOT how to reach the microservice's broker topic. That topic (+ its
    queue/exchange) must ALSO exist in the **gateway's own** `broker` config, or the forwarded
    request fails with `Topic ... not found in configuration`.

## connection_name (broadcast / WebSocket / route-discovery)
11. **`broadcast` + WebSocket require `connection_name`** (`clientProperties.connection_name`,
    or `broker.routeDiscovery.serviceName` which fills it when unset), else throw at boot.
12. **`connection_name` is a LOGICAL name: the library auto-appends `-<hostname>-<pid>` per
    instance** (hostname is unique per container/pod; under Docker pid is always 1). Replicas can
    share one config. Historical context: with a literally shared name RabbitMQ round-robined
    broadcast/WS messages between instances. Auto-created broadcast queues are `autoDelete`.

## Queues / overload
Unbounded work queues trip RabbitMQ's mem/disk alarms → ALL publishers blocked. Set
`messageTtl`/`maxLength` in `queues[].options` (⚠️ changing options on an EXISTING queue →
406 loop; delete it first or use a broker policy). Put `gw-metrics-track` on the optional
dedicated `rlb-gateway-metrics` topic (+ own bounded queue, `gateway.metrics.topic` → it):
on the shared admin queue a slow metrics DB starves `gw-health`/`gw-reload`/admin RPCs.

## RPC / timeout / errors
Handler failures follow a BOUNDED retry policy (`broker.retry` / `topics[].retry`:
`maxAttempts`, `delayMs`, `onExhausted: dead-letter|drop`; built-in default 5 attempts → drop) —
the old infinite nack-requeue default is gone. Exhausted RPC messages reply `RetryExhaustedError`
(gateway → 502); deserialization/pipe-validation failures skip retries. `deadLetter.exchange`
must be declared in `broker.exchanges` AND have a queue bound to it — with no binding the broker
discards the copy and `dead-letter` silently behaves like `drop`. Explicit legacy `errorBehavior`
still wins over defaults. Greppable failure logs, named by topic + envelope action (falling back
to the queue name): `[RETRY]` per attempt, `[RETRY][EXHAUSTED]` when attempts run out,
`[RETRY][LOOP]` when a message returns already exhausted.

⚠️ **Queue loops.** `BrokerService` audits these at boot (warn/error, never blocks):
(a) `errorBehavior: requeue` nack-requeues forever with no attempt counter AND, being more
specific, disables `broker.retry` for its topic — never use it; (b) a `deadLetter.exchange`
reachable from the consuming queue re-injects every exhausted message: the DL copy keeps the
message's ORIGINAL routing key unless `deadLetter.routingKey` says otherwise, so reusing the work
exchange closes the loop (a copy that comes back already exhausted is now dropped, not
re-dead-lettered); (c) a queue-level `deadLetterExchange` bound back to its own queue recycles
every `messageTtl`/`maxLength`/nack eviction. Also outside the policy's reach: an explicit
`Nack(true)` from a handler, and a poison message that crashes the process before the ack.
13. **Wrong `replyQueues` key → silent timeout.** `requestData` resolves `replyTo` from
    `broker.replyQueues[exchange]`; absent → RabbitMQ direct-reply-to. Wrong exchange key → no
    reply routed back → the call just times out.
14. **Handler exceptions don't crash the consumer.** Returned as `{success:false,error}`; on the
    RPC path that error IS the reply and the message is ACKED — the retry policy never sees it
    (only `handle`/`broadcast` handlers rethrow into it, and `toObservable` topics ack blindly);
    `requestData` re-throws on the caller side. Gateway HTTP status derives from `error.name` —
    give errors a meaningful `name` (`BadRequestError`, `NotFoundError`, `ConflictError`,
    `ForbiddenError`, `UnauthorizedError`); anything unrecognized → 500.
15. **Default RPC timeout 10s** (`broker.defaultRpcTimeout`). Override per route (`paths[].timeout`)
    or per `requestData` call for slow RPCs.

## Gateway HTTP
16. **Boolean RPCs return `200` with `true`/`false`, not `204`.** A *defined* result — including
    falsy `false`/`0`/`""` — is real content, sent as `200` + JSON. Only `null`/`undefined`
    collapses to `204`. So `GET /acl/check?...` answers `200 false` for "no" — don't treat any
    2xx as "allowed", read the body. (The old "always 204" bug is fixed.)
17. **`parseRaw: true` needs `NestFactory.create(AppModule, { rawBody: true })`** or `$raw` is
    `undefined`.
18. **Route params win over body/query** (merged in last). Watch key collisions (`:id` vs `body.id`).
19. **Uploads live in `$files`** (multer `.any()`); buffers are converted to **binary strings** —
    re-encode carefully on the consumer (`Buffer.from(str, 'binary')`).
20. **`/health` is a tiny liveness probe.** Action `gw-health` → `{ status: 'ok' }` (a real 200),
    NOT a metrics dump. Use `/admin/metrics*` (`gw-metrics-*`) for metrics.

## Auth / ACL
21. **`actions` require `auth` on the same path/event.** No `auth` → no identity → fails closed
    (every request `403`, logged at boot). Always pair `actions: [...]` with `auth: <provider>`.
22. **`actions` require an `IAclRoleService`** registered via `RLB_GTW_ACL_ROLE_SERVICE` in
    `ProxyModule.forRootAsync({ providers: [...] })`. Missing → deny (403). The gateway check is
    **action-based, OR, resource-SCOPED** (`checkAction(userId, ctx, actions)`): `actions` lists
    ACTION NAMES, the caller is authorized if it holds AT LEAST ONE on the request's
    `(companyId, resourceId)`. The provider only needs `uidClaim` (+ `headerPrefix`).
23. **One ACL check action on `rlb-acl`: `acl-check-action`** (cached, HTTP GET → `200` true/false).
    `checkAction(userId, ctx, action)`, `ctx = { companyId?, resourceId? }`,
    `action = string | string[]` (OR). It resolves action→roles-that-include-it, then matches the
    user's grants. A grant authorizes **iff** `grant.companyId === req.companyId &&
    grant.resourceId === req.resourceId` (undefined/null/`''` = absent). The ONLY carve-out: both
    ids absent on request AND grant. **No wildcard** — a `null` `resourceId` does NOT match
    everything; `companyId` is load-bearing. Replaces the old `acl-can-user-do` /
    `acl-can-user-do-gtw` and the merged `GET /acl/check` + `/acl/check-resource`.
23a. **Gateway gating is ACTION-based, not role-based.** `gateway.paths[].actions` /
    `events[].actions` name ACTIONS (was `roles`). The gateway resolves `userId` from the auth
    provider, extracts `(companyId, resourceId)` from the request, and authorizes if the caller
    holds one of `actions` on that pair. It reads the canonical `companyId`/`resourceId` from the
    request (precedence params→query→body) and matches them exactly. WS events gate by `actions`
    **resource-agnostically**.
23b. **`@BrokerAuth`'s 3rd param is now `actions` (was `roles`).** Signature:
    `@BrokerAuth(authName, allowAnonymous?, actions?, httpName?)`. Pass action names there for an
    auto-discovered route's action gate.
24. **Actions, roles & auth-providers are NAME-KEYED. PUT upserts; there is NO POST.** The `name`
    IS the key (no id). `PUT` creates-or-updates, `GET` lists, `GET .../get?name=` reads one,
    `DELETE` removes by `name`. The old id-based ACL CRUD and `POST`-create endpoints are GONE.
    (Gateway-admin **paths** are the exception — they keep id-keyed CRUD and a POST create.)
25. **`acl-grant` / `acl-revoke` both REQUIRE `userId` + `roles`** (optional `resourceId` +
    `companyId`). The grant record is keyed by `(userId, companyId, resourceId)`. `grant` MERGES
    roles into that triple (idempotent). `revoke` REMOVES exactly those roles and **deletes the
    record once it has no roles left**. `revoke` without `roles` throws `400 roles are required` —
    to wipe a grant, revoke all its roles. **Grants assign ROLES (keep the `roles` param); roles
    contain actions.** Only the gateway/route GATE switched to action names.
25a. **`acl-grant` / `acl-revoke` are GATED.** The caller (forwarded `X-GTW-AUTH-USERID`) must hold
    the `role-management` action on the TARGET `(companyId, resourceId)`, else `403`. The gate
    action defaults to `role-management`, overridable via `AclModuleOptions.roleManagementAction`.
    **Chicken-and-egg:** no caller can grant the very first `role-management`, so **bootstrap by
    seeding the first `role-management` grant directly in the DB**.
26. **`companyId` is LOAD-BEARING in authorization.** It replaced `resourceBusinessId` and is
    BOTH part of the grant identity AND matched during `checkAction`: a grant authorizes only when
    `grant.companyId === req.companyId` (and `resourceId` likewise). It also groups
    `acl-list-resources-by-user` output. There is **no wildcard** — a `null`/absent `resourceId`
    only matches a request with that id also absent. Both grant/revoke validate every role exists
    (unknown → `400`).
27. **Removed actions:** `acl-list-by-user`, `acl-verify-access`, `acl-can-user-do`, and
    `acl-can-user-do-gtw` no longer exist (the last two collapsed into `acl-check-action`). Use
    `acl-check-action` for authorization checks and `acl-list-resources-by-user` to list resources.
28. **Auth & gateway config go to `ProxyModule`** (`authOptions` / `gatewayOptions`), not
    `BrokerModule`. `BrokerModule` owns only `options` / `topics` / `appOptions`.

## Auth providers (hardening)
29. **JWKS verifies TLS by default.** `httpsAllowUnauthorized: true` only for self-signed dev issuers.
30. **`algorithms` is REQUIRED for `jwt`/`jwks`.** Omitting denies verification (algorithm-confusion
    guard). For `jwks` only asymmetric algs are allowed (`RS*`/`ES*`/`PS*`); `HS*`/`none` rejected.
31. **Define `jwtMap` or NO claims are forwarded.** Without it the token is still accepted
    (`success:true`) but no identity headers go downstream — fail-safe, not a leak. Declare it to
    emit `X-GTW-AUTH-USERID` and friends.
32. **`str-compare`/`basic` PASS THROUGH when their secret is unset — by design.** A `str-compare`
    with no `secret`, or a `basic` with no `clientSecret`, authenticates EVERY request (effectively
    open/disabled). Set the secret to enforce it.
33. **Credential `mechanism` must be `PLAIN` | `EXTERNAL` | `AMQPLAIN`** (case-insensitive). Unknown
    value leaves SASL `response` unset → AMQP auth fails.

## WebSocket
34. **Auth is per-event, not global.** `events[].auth` names the provider that verifies the
    connection token AND maps its claims for THAT event (memoized per provider at subscribe). `scopeClaim`
    references the MAPPED claim (prefixed, e.g. `X-GTW-AUTH-USERID`), `payloadKey` is the payload
    field. **`scopeClaim` without `payloadKey` denies everything** (safe default). `requireAuth:false`
    makes `auth` optional (anon allowed; claims mapped if a token is present). `gateway.ws` carries
    only connection-level limits/heartbeat — no auth fields.
35. **Don't bind a WS event to a fixed durable queue.** The lib creates a per-instance exclusive
    ephemeral queue for fan-out; a shared/durable queue makes instances compete and clients on one
    instance miss messages delivered to another.
36. **Token rides in the subprotocol**: `new WebSocket(url, [token])` (browsers can't set handshake
    headers). The session is bounded by the JWT `exp` — closed with `1008` on expiry, nothing
    delivered afterward. Long-lived clients need token refresh + reconnect.
37. **Set `gateway.ws.allowedOrigins`** to reject cross-site handshakes; omitted → all Origins
    accepted (logged at boot). `maxMessageBytes` (default 16384) drops oversized client frames.
    `maxBufferedBytes` (default 1 MiB) is the outbound backpressure cap: a slow client above it
    has its messages dropped until it drains. A down `loadConfig.events` source no longer crashes
    the gateway at boot: it degrades to YAML-only events (remote ones missing until restart).

## Publish / events
38. **`publishMessage` is `async` — `await` it** for the publisher-confirm guarantee and to catch
    failures. Un-awaited = fire-and-forget without guarantee. (For an `event`-mode route the gateway
    awaits the confirm before returning the 2xx — the success status is not optimistic.)

## Reload & route auto-discovery
39. **The only reload action is `gw-reload`** (`GW_RELOAD_ACTION`). The control-topic subscriber
    rebuilds routes ONLY for `gw-reload`; every other message on the control topic is ignored.
    Seed then reload: `POST /admin/paths` → `POST /admin/reload` (publishes `gw-reload` on
    `rlb-gateway-control`). No restart. Concurrent reloads are coalesced into one extra pass.
40. **Route-discovery config is SPLIT; exchange/queue MUST match on both sides.**
    - **Publisher (microservice):** `broker.routeDiscovery { serviceName, publishOnBoot, exchange?, queue? }`.
      `serviceName` is required to publish and also fills `connection_name` when unset.
    - **Consumer (gateway):** `GatewayAdminModule` `routeDiscovery { exchange?, queue? }` (NEST code,
      no `serviceName` — the gateway only receives).
    Both default to `exchange: rlb-route-discovery` / `queue: rlb-route-sync`. Override only to
    namespace per env — but set the SAME values on BOTH sides or manifests never reach the gateway.
41. **Topic NAMES `rlb-acl` / `rlb-gateway-admin` / `rlb-gateway-control` and all action strings
    are decorator-bound and NOT configurable.** Only exchange/queue/routingKey and the
    route-discovery exchange/queue are. The route-sync handler never throws (logs + acks, no poison
    loop); an empty manifest soft-disables a service's existing routes (and logs a warning).
