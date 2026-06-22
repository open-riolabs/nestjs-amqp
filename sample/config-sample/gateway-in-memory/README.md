***REMOVED*** gateway-in-memory

A full HTTP + WebSocket **gateway** for `@open-rlb/nestjs-amqp` that keeps **all** of its
state in RAM. The ACL store, the gateway-admin DB routes / auth-providers / metrics, and the
route-sync journal are all backed by tiny in-process collections instead of a real database.

Because nothing is persisted, this sample boots with **only a reachable RabbitMQ** — no
MongoDB and no Redis. It is the formerly-internal `apps/gateway-2` example, repackaged as a
standalone, runnable sample.

> **Ephemeral by design.** Every store lives in a per-process `Map`. Data is lost on restart,
> and nothing is shared across instances (the in-memory ACL L2 cache cannot broadcast
> invalidations to peers). This is a quick-start / local-dev / demo harness, **not** a
> production deployment. For a real deployment, plug shared stores (Mongo, Redis, …) under the
> same repository / cache tokens — see the `gateway-db` sample.

***REMOVED******REMOVED*** What it demonstrates

- **ACL name-keyed CRUD** — actions and roles are keyed by `name`: `PUT` upserts (idempotent,
  create-or-update), `GET` lists, `GET …/get?name=` reads one, `DELETE` removes by name. Grants
  bind a `userId` to roles, optionally scoped to a `companyId` / `resourceId`.
- **ACL check over HTTP** — the single authorization primitive `acl-check-action`
  (`GET /acl/check?userId=&action=&companyId=&resourceId=`): `checkAction(userId, {companyId?,
  resourceId?}, action)` returns `200` with a JSON `true`/`false` body (a defined falsy answer is
  real content, not a `204`). A grant authorizes only on the EXACT `(companyId, resourceId)` — no
  wildcard; both ids absent matches resource-less grants only.
- **Action-gated `/protected`** — a Keycloak/JWKS JWT plus `actions: [gateway-access]`: the gateway
  resolves the user id from the token, extracts the request's `(companyId, resourceId)`, and passes
  the caller if they hold **at least one** of those actions on that scope.
- **Gateway-admin DB routes + runtime reload** — routes can be created in the in-memory store
  (`POST /admin/paths`) and registered on Express at runtime via a broadcast reload
  (`POST /admin/reload`) — no restart.
- **Route auto-discovery CONSUMER** — `GatewayAdminModule` wires the route-sync service; this app
  also plays the **publisher** (the demo microservice) and announces its decorator-discovered
  routes on boot. Discovered routes are synced into the in-memory store and registered; collisions
  with existing routes are skipped and journaled.
- **In-proxy metrics hook** — every served request is emitted to the gateway-admin metrics sink
  **and** to an optional in-process `GatewayMetricsHook` (an example InfluxDB line-protocol writer).
- **WebSocket fan-out** — `main.ts` installs the `WsAdapter`, so the gateway's WebSocket layer is
  available for per-event, per-user broker → client streaming. (No `gateway.events[]` are declared
  in this sample's config; see [`docs/gateway.md`](../../../docs/gateway.md) and
  [`web-socket-sample.html`](../../../web-socket-sample.html) to add and drive one.)

***REMOVED******REMOVED*** What it wires (`src/app.module.ts`)

- **`BrokerModule.forRootAsync`** — the AMQP connection, topics and queues. The
  route-discovery **publisher** lives inside the broker block as `broker.routeDiscovery`
  (`serviceName: demo-ms`, `publishOnBoot: true`).
- **`ProxyModule.forRootAsync`** — the gateway itself (`gatewayOptions` = the `gateway:` block,
  `authOptions` = `auth-providers:`), plus two DI bindings:
  - `RLB_GTW_ACL_ROLE_SERVICE` → `useExisting: AclService` (required for the action-gated paths so the
    gateway can run `checkAction` in-process);
  - `RLB_GTW_METRICS_HOOK` → `useClass: InfluxMetricsHook` (the optional in-proxy metrics sink).
- **`AclModule.forRoot`** — binds the abstract `AclActionRepository` / `AclRoleRepository` /
  `AclGrantRepository` tokens to the in-memory repositories, and `RLB_ACL_CACHE_STORE` to
  `InMemoryAclStore` (the RAM L2 cache). Cache TTLs: `ramTtlMs: 30000`, `l2TtlSec: 600`.
- **`GatewayAdminModule.forRoot`** — binds `HttpPathRepository`, `AuthProviderRepository`,
  `HttpMetricRepository` and the `RouteSyncLogRepository` (the consumer-side route-sync journal) to
  the in-memory repositories.
- **`RouteDiscoveryDemoService`** (in `providers`) — the in-process demo microservice whose
  `@BrokerHTTP`/`@BrokerAction` routes drive the auto-discovery demo.

The concrete in-memory classes are provided by a `@Global` **`DatabaseModule`** and aliased onto
the library's abstract tokens with `useExisting`.

***REMOVED******REMOVED******REMOVED*** In-memory building blocks (`src/`)

| File | Role |
| --- | --- |
| `modules/database/repository/in-memory-collection.ts` | A tiny `Map`-backed collection mimicking the slice of Mongo behavior the repos need (CRUD by id/filter, `$in`, pagination). |
| `modules/database/repository/acl.repository.ts` | `InMemoryAclActionRepository` / `…RoleRepository` / `…GrantRepository`. |
| `modules/database/repository/gateway.repository.ts` | `InMemoryHttpPathRepository` / `…AuthProviderRepository` / `…HttpMetricRepository` (counters + raw time-series points). |
| `modules/database/repository/route-sync.repository.ts` | `InMemoryRouteSyncLogRepository` — the route-sync journal. |
| `cache/in-memory-acl-store.ts` | `InMemoryAclStore` — RAM L2 ACL cache implementing the `AclCacheStore` contract (string `'1'`/`'0'` decisions with a TTL). |
| `metrics/influx-metrics-hook.ts` | `InfluxMetricsHook` — example `GatewayMetricsHook` writing each request to InfluxDB via line protocol. **No-op until** `INFLUX_URL`, `INFLUX_TOKEN`, `INFLUX_ORG` (+ optional `INFLUX_BUCKET`) env vars are set, so the sample boots without InfluxDB. |
| `samples/route-discovery-demo.service.ts` | `RouteDiscoveryDemoService` — the publisher-side demo microservice. |

***REMOVED******REMOVED*** Fixed names vs. configurable wiring

These are **decorator-bound** on the backend handlers and are **not** configurable — your YAML
must reference them literally:

- **Topic names:** `rlb-acl` (ACL handlers), `rlb-gateway-admin` (gateway-admin handlers),
  `rlb-gateway-control` (the broadcast reload control topic).
- **Action strings:** e.g. `acl-action-update`, `acl-role-update`, `acl-check-action`,
  `gw-path-export`, `gw-metrics-track`, `gw-reload`, `demo.echo`.

What **is** configurable: the AMQP `uri`/credentials, the exchange/queue/`routingKey` declarations,
and the route-discovery `exchange`/`queue` (which default to `rlb-route-discovery` /
`rlb-route-sync`). Under `broker.routeDiscovery`, `serviceName` would promote to the AMQP
`connection_name` if one were not already set — in this sample `connection_name` is set explicitly
(`gateway-in-memory`), so it wins.

***REMOVED******REMOVED*** Prerequisites

- A reachable **RabbitMQ**. Edit `config/config.yaml` → `broker.uri` (and the credentials under
  `broker.connectionManagerOptions.connectionOptions.credentials`) to point at it.

> **All hostnames and credentials in `config/config.yaml` are placeholders.** The broker URI is
> `amqp://localhost:5672/`, the auth-provider issuer/JWKS point at
> `https://auth.example.com/realms/demo`, and broker credentials are redacted. Replace them with
> your own values before running against real infrastructure.

***REMOVED******REMOVED*** How to run

From **VS Code**: pick the launch configuration **"Debug gateway-in-memory (in-memory stores)"**
and press **F5**. It runs `src/main.ts` via `ts-node` on `PORT=3000`.

From a terminal at the **repo root** (uses the in-tree workspace lib):

```bash
npx nest start gateway-in-memory
```

The gateway then listens on `http://localhost:3000` (`app.port` / `app.host` in the YAML, overridable
via `PORT`).

> **Dependency note.** `package.json` pins `@open-rlb/nestjs-amqp` `^2.0.5`. In-tree, the import
> resolves to the **local workspace library** rather than the published package.

***REMOVED******REMOVED*** Postman collection

`gateway-in-memory.postman_collection.json` is a runnable, ordered playlist
("setup & test playlist") that walks the whole surface end to end:

- **0 — Auth & health:** Keycloak password-grant login (captures `token` + `userId`), `GET /health`,
  and `GET /protected` returning `403` before any grant.
- **1–2 — ACL actions & roles:** full name-keyed CRUD, including idempotent re-`PUT` and
  `GET …/get?name=`.
- **3–4 — Grant + `/protected`:** grant the logged-in user, watch `/protected` flip `403 → 200`,
  then `401` without a token, `403` after revoke, and back to `200` after re-grant.
- **4b — ACL check:** `acl-check-action` (`/acl/check`, OR semantics over actions, scoped to the
  exact `(companyId, resourceId)`), and `/acl/resources`.
- **4c — Auth-gate semantics:** `allowAnonymous` bypass, `actions` without `auth` failing closed
  (`403`), an unknown auth-provider failing closed (`401`, never `500`), and the anti-spoofing
  check that a client-supplied `X-GTW-AUTH-USERID` is ignored.
- **5–7 — Gateway-admin:** DB route CRUD + `export`, auth-provider upserts, and the auto-collected
  per-route metrics.
- **8 — Runtime reload:** create a DB route → `404` (not in Express yet) → `POST /admin/reload` →
  `200` (added at runtime, no restart) → delete + reload → `404` again.
- **9 — Cleanup (optional).**

Before running it, set the collection variables: `kcTokenUrl`, `kcClientId`, `kcUsername`,
`kcPassword` (all currently `https://auth.example.com/realms/demo…` / `REPLACE_ME` placeholders)
to a **real** JWKS/OIDC provider, and make `auth-providers[0]` in `config/config.yaml`
(`gateway-jwks`) point at the same realm (`issuer`, `tokenUrl`, `jwksUri`, `clientId`). `baseUrl`
defaults to `http://localhost:3000`.

***REMOVED******REMOVED*** See also

- [`docs/gateway.md`](../../../docs/gateway.md) — the `gateway:` block, auth gate, WebSocket events.
- [`docs/acl.md`](../../../docs/acl.md) — actions / roles / grants, the `acl-check-action` check, and the cache.
- [`docs/gateway-admin.md`](../../../docs/gateway-admin.md) — DB routes, metrics, route auto-discovery.
