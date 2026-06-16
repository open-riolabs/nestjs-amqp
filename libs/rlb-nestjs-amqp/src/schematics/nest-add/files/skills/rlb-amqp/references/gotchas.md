***REMOVED*** Gotchas — bug-prone cases checklist

Scan this before adding/changing a topic, queue, exchange, action, route, auth provider
or WS event. Each item is a real failure mode in this codebase.

***REMOVED******REMOVED*** Decorators & handlers
1. **No destructuring in `@BrokerAction` parameters.** Param→message mapping parses the
   function source with a regex (`getParamNames`). `fn({a,b})` misaligns indices. Use flat
   params.
2. **Avoid default parameter values.** Only a basic `= value` strip exists
   (`removeDefaultsFromParams`); complex defaults misalign mapping. Always pass an explicit
   `name` to `@BrokerParam`.
3. **`(topic, action)` must be unique.** All `@BrokerAction` of a topic share ONE
   consumer/queue, dispatched by `action`. A duplicate `(topic, action)` overwrites the
   previous one silently.
4. **Forwarded headers are UPPERCASE + prefixed.** Read `@BrokerParam('header',
   'X-GTW-AUTH-USERID')`, not `'userId'`.

***REMOVED******REMOVED*** Topic ↔ queue ↔ exchange wiring
5. **The topic `name` must match everywhere**: `@BrokerAction`, `topics[].name`,
   `requestData`/`publishMessage`, `gateway.paths[].topic` / `events[]`. Typo →
   `Topic X not found in configuration`.
6. **`mode: rpc`/`handle` need `topics[].queue` in `broker.queues[]`**, and that queue's
   `exchange` in `broker.exchanges[]`. In `handle` a missing queue throws NPE at boot
   (`queue.exchange`).
7. **Exchange `type: topic` → queue MUST have `routingKey`**, else boot throws
   `Queue ... has no routing key`.
8. **`broadcast` + WebSocket gateway require `connection_name`** (`clientProperties`), else
   throw.

***REMOVED******REMOVED*** RPC / timeout / errors
9. **RPC reply routing**: `requestData` resolves `replyTo` from `broker.replyQueues[exchange]`;
   absent → RabbitMQ direct-reply-to. Wrong exchange key in `replyQueues` → no reply → timeout.
10. **Handler exceptions don't throw on the consumer**: returned as `{success:false,error}`;
    `requestData` re-throws to the caller. Gateway status derives from `error.name` — give
    errors a meaningful `name`.
11. **Default RPC timeout 10s** (or `broker.defaultRpcTimeout`). Set `timeout` per path /
    per `requestData` call for slow RPCs.

***REMOVED******REMOVED*** Gateway HTTP
12. **`parseRaw: true` needs `NestFactory.create(AppModule, { rawBody: true })`** or `$raw`
    is `undefined`.
13. **Route params win over body/query** (re-applied last). Watch key collisions (`:id`
    vs `body.id`).
14. **Uploads are in `$files`** (multer `.any()`); buffers are converted to binary strings —
    handle re-encoding carefully on the consumer side.

***REMOVED******REMOVED*** Auth / ACL
15. **`roles` on an HTTP path require an `IAclRoleService`** registered via
    `RLB_GTW_ACL_ROLE_SERVICE` in `ProxyModule.forRootAsync({ providers: [...] })`. The
    gateway check is **role-based** (`canUserDoGtw(path.roles, userId)`): `path.roles` lists
    ROLE NAMES and the user passes if they hold AT LEAST ONE (resource-agnostic primary
    filter). The provider only needs `uidClaim` (+ `headerPrefix`) to extract the userId —
    no topic/action.
16. **Two role-based ACL checks** on `rlb-acl` (both cached, inputs = userId + roles only):
    `acl-can-user-do-gtw` → `canUserDoGtw(roles, userId)` (gateway primary filter, OR,
    resource-agnostic) and `acl-can-user-do` → `canUserDo(roles, userId, resourceId)`
    (**ms-side**; a global grant OR a grant on that resource satisfies it — the resource is
    known only to the target ms).
17. **Auth-providers + gateway config are passed to `ProxyModule`** (`authOptions` /
    `gatewayOptions`), not `BrokerModule`. `BrokerModule` owns only `options`/`topics`/`appOptions`.

***REMOVED******REMOVED*** WebSocket
16. **Auth is per-event, not global.** `events[].auth` names the provider that verifies the
    connection token AND maps its claims for THAT event (at subscribe time, memoized per
    provider). `scopeClaim` references the MAPPED claim (with `headerPrefix`, e.g.
    `X-GTW-AUTH-USERID`), not the raw token claim. `payloadKey` is the event-payload field.
    `scopeClaim` without `payloadKey` denies everything (safe default). `requireAuth: false`
    on an event makes `auth` optional (anon allowed, claims mapped if a token is present).
    `gateway.ws` only carries connection-level limits/heartbeat — no auth fields.
17. **Don't use a fixed durable queue for WS events.** The lib creates a per-instance
    exclusive ephemeral queue for fan-out; a shared queue makes instances compete and clients
    on one instance miss messages.
18. **Token transport is the subprotocol**: `new WebSocket(url, [token])`. Browsers can't set
    custom handshake headers.

***REMOVED******REMOVED*** Publish / event
19. **`publishMessage` is `async` — `await` it** for the publisher-confirm guarantee and to
    catch failures. Un-awaited = fire-and-forget without guarantee.
20. **`handle`/`broadcast` handlers must return `void`**; a return value logs
    `Subscribe handlers should only return void`.

***REMOVED******REMOVED*** TLS / credentials / provider hardening
21. **JWKS verifies TLS by default.** `httpsAllowUnauthorized: true` only for self-signed dev
    issuers.
22. **Credential `mechanism`**: `PLAIN` | `EXTERNAL` | `AMQPLAIN` (case-insensitive). Unknown
    value leaves `response` unset → auth fails.
23. **`algorithms` is REQUIRED for `jwt`/`jwks`.** If omitted, verification is denied
    (algorithm-confusion guard). For `jwks` only asymmetric algs are allowed (RS*/ES*/PS*);
    `HS*`/`none` are rejected.
24. **`str-compare`/`basic` PASS THROUGH when their secret is unset.** A `str-compare`
    without `secret` or a `basic` without `clientSecret` treats every request as authenticated
    (provider effectively open/disabled — by design). Set the secret to actually enforce it.
25. **Define `jwtMap`.** Without it NO claims are forwarded (the token is still accepted,
    `success:true`): the gateway fails safe instead of leaking the whole payload. Declare it
    to forward identity headers (e.g. `X-GTW-AUTH-USERID`).

***REMOVED******REMOVED*** WebSocket session/transport security
26. **WS sessions are bounded by the token `exp`.** The connection is closed (`1008`) when the
    JWT expires; no delivery happens afterward. Long-lived sockets need token refresh +
    reconnect.
27. **Set `gateway.ws.allowedOrigins`** to reject cross-site handshakes; if omitted, all
    Origins are accepted (logged at boot). `maxMessageBytes` (default 16384) drops oversized
    client frames.
