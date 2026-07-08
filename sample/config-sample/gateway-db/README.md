# gateway-db — MongoDB-backed gateway sample

A persistent variant of the `@open-rlb/nestjs-amqp` HTTP/WebSocket gateway sample. It exposes the
**same gateway surface** as [`gateway-in-memory`](../gateway-in-memory) — the same ACL actions/roles/grants,
the same gateway-admin route/auth/metrics management, and the same route auto-discovery consumer — but
every store that the in-memory sample keeps in RAM is here backed by **MongoDB via Mongoose**.

> This sample was formerly known as *Archive*. The internal data connection is still named `gateway-2`
> (see `src/modules/database/connections.ts`), which also seeds the AMQP `connection_name` style identity.

---

## Purpose

The library ships the ACL and gateway-admin **services**; you supply the concrete **repositories**. In
`gateway-in-memory` those repositories are plain in-process maps. In `gateway-db` they are Mongoose
repositories, so the data survives restarts:

| Data | Persisted in MongoDB | Backing repository |
| --- | --- | --- |
| ACL actions | yes | `MongoAclActionRepository` |
| ACL roles | yes | `MongoAclRoleRepository` |
| ACL grants (per user / resource) | yes | `MongoAclGrantRepository` |
| Gateway HTTP routes | yes | `MongoHttpPathRepository` |
| Stored auth-providers | yes | `MongoAuthProviderRepository` |
| Request metrics: rolling counters | yes | `MongoHttpMetricRepository` |
| Request metrics: raw data points (time-series source) | yes | `MongoHttpMetricRepository` (point model) |
| Route auto-discovery journal | yes | `MongoRouteSyncLogRepository` |

Two things deliberately stay **non-Mongo**:

- **ACL L2 cache is still in-RAM here.** The `RLB_ACL_CACHE_STORE` token is bound to `InMemoryAclStore`,
  a per-process `Map` that implements the same string-decision + TTL contract a Redis store would. It is
  **not** suitable for multi-instance deployments (invalidations on one instance never reach the others) —
  swap in a shared store (Redis, …) for production. ACL's L1 RAM tier (default 30000 ms) is unchanged.
- **Optional InfluxDB time-series** via the in-proxy metrics hook (`InfluxMetricsHook`), which is a no-op
  until configured (see below). This is *separate* from the broker-based `gateway.metrics` sink that writes
  to Mongo — both can be active at once.

## Use cases

- **Production-like persistence** — routes, auth-providers, ACL data and metrics survive process restarts.
- **Surviving restarts** — seed routes/roles once via the admin API; they are reloaded from Mongo on boot.
- **Time-series metrics** — raw `http-metric-point` documents feed bucketed `gw-metrics-series` queries,
  and (optionally) the `InfluxMetricsHook` streams each call to InfluxDB for Flux dashboards.
- **Route auto-discovery journal** — every added / updated / removed / collision / invalid / reload event is
  written to the `route-sync-log` collection so you can audit what each microservice announced.

---

## How the data is wired

### Connection

`DatabaseModule` (`src/modules/database/database.module.ts`) is a `@Global()` module that opens **one**
Mongoose connection, named by `DATA_CONNECTION_NAME` (`gateway-2`) from
`src/modules/database/connections.ts`. The same file defines the per-model DI tokens
(`ACL_ACTION_MODEL`, `HTTP_PATH_MODEL`, `HTTP_METRIC_POINT_MODEL`, `ROUTE_SYNC_LOG_MODEL`, …).

`dbFactory` builds the Mongo URI from the **`data-mongodb`** config block (read from `config.yaml`, like
every other setting — no env vars). It:

- starts from `protocol://`;
- prepends `user:password@` **only** when `auth: true` and both credentials are present;
- joins `host` — which accepts a single string **or** an array of hosts (for a replica set);
- appends `?<options>` (e.g. `authSource`, `readPreference`, `replicaSet`) when `options` is set;
- and passes `database` as the Mongoose `dbName`.

### Repository bindings

`src/app.module.ts` binds the library's abstract repository tokens to the Mongo implementations:

- `AclModule.forRoot([...])` → `AclActionRepository`, `AclRoleRepository`, `AclGrantRepository` → the
  `Mongo*` classes, plus `RLB_ACL_CACHE_STORE → InMemoryAclStore` and cache TTLs `{ ramTtlMs: 30000, l2TtlSec: 600 }`.
- `GatewayAdminModule.forRoot([...])` → `HttpPathRepository`, `AuthProviderRepository`,
  `HttpMetricRepository`, `RouteSyncLogRepository` → the `Mongo*` classes. `RouteSyncService`
  (route auto-discovery consumer) is wired internally by the module.
- `ProxyModule.forRootAsync({ providers: [...] })` binds the in-process role gate
  (`RLB_GTW_ACL_ROLE_SERVICE → AclService`, so roles-protected paths resolve without a broker round-trip)
  and the in-proxy metrics hook (`RLB_GTW_METRICS_HOOK → InfluxMetricsHook`).

---

## Configuration (`config/config.yaml`)

> All credentials in the shipped config are placeholders (`REPLACE_ME`). Replace them with your own
> values; never commit real secrets.

### `data-mongodb`

Defaults to a local single-node dev Mongo at `localhost:27017`, database `amqp-gateway`, `auth: false`.
For an authenticated cluster / replica set, set `auth: true`, fill `user`/`password`, list every `host`,
and add `options.replicaSet` / `options.authSource` as needed.

```yaml
data-mongodb:
  protocol: mongodb
  host: localhost:27017      # single string OR a YAML list of hosts
  user: REPLACE_ME
  password: REPLACE_ME
  database: amqp-gateway
  auth: false                # true → prepend user:password@ to the URI
  options:
    authSource: admin
    readPreference: primary
```

### `influx` (optional time-series sink)

Read from config like everything else (no env vars). The `InfluxMetricsHook` is a **no-op until
`influx.url`, `influx.token` and `influx.org` are ALL set** — leave `token`/`org` blank to keep the gateway
booting without an InfluxDB instance. When enabled it writes one point per served request using the v2
write API + line protocol over HTTP (measurement `http_request`, tags `method`/`route`/`status`/`mode`/`action`,
fields `duration_ms`+`count`).

```yaml
influx:
  url: http://localhost:8086
  token:                     # blank → hook stays a no-op
  org:                       # blank → hook stays a no-op
  bucket: gateway
```

### Broker, topics, gateway

Identical in shape to the in-memory sample. Points to note:

- **Topic names and action strings are decorator-bound and NOT configurable.** The gateway-admin
  handlers consume the topic literally named `rlb-gateway-admin`; ACL handlers consume `rlb-acl`; the
  runtime reload control topic is `rlb-gateway-control`. Action strings such as `acl-action-update`,
  `gw-path-export`, `gw-metrics-track`, `gw-health` and `gw-reload` are likewise fixed in code. Only the
  **exchange / queue / routingKey** of those topics (and the route-discovery exchange/queue) are configurable.
- `gateway.loadConfig.paths` points at `topic: rlb-gateway-admin, action: gw-path-export`, so DB-stored
  routes are merged with the YAML `gateway.paths[]` on boot and on every reload.
- `gateway.metrics` points at `gw-metrics-track` (`mode: event`), the per-call sink that updates the
  rolling counters and appends a raw data point in Mongo.
- `gateway.reloadTopic: rlb-gateway-control` — the broadcast topic the gateway subscribes to and that
  route auto-discovery publishes `gw-reload` on after applying a manifest.

### Route auto-discovery (consumer side)

The gateway is the **consumer** in route auto-discovery: `RouteSyncService` (wired by `GatewayAdminModule`)
listens for route manifests published by microservices, diffs them against the DB, applies changes, journals
every event to the `route-sync-log` collection, and broadcasts `gw-reload`. The consumer's discovery
exchange/queue default to `rlb-route-discovery` / `rlb-route-sync` and **must match** the publishers'
`broker.routeDiscovery` values.

> On the **publisher** side (any microservice that announces its own routes), the matching config lives
> *inside* the broker block as `broker.routeDiscovery`, where `serviceName` is required to publish and also
> promotes to the AMQP `connection_name` when none is set explicitly. This gateway sample is a consumer, so
> it has no `broker.routeDiscovery` block. See [docs/gateway-admin.md](../../../docs/gateway-admin.md).

The shipped `config.yaml` also declares a `demo-ms` queue/topic so the gateway can route forwarded calls to
a route-discovery demo microservice once one announces itself.

---

## How to run

1. Start a reachable **MongoDB** (defaults to `localhost:27017`, `auth: false`; edit `data-mongodb` in
   `config/config.yaml` to point elsewhere).
2. Start a reachable **RabbitMQ** (the broker `uri` defaults to `amqp://localhost:5672/`).
3. (Optional) Start **InfluxDB** and fill `influx.url`/`token`/`org`/`bucket` — otherwise the metrics hook
   stays a harmless no-op and logs a warning on boot.
4. Launch the gateway, either:
   - **VS Code** → Run and Debug → **"Debug gateway-db (MongoDB)"** (runs on `PORT=3002`), or
   - CLI: `npx nest start gateway-db`.

The gateway serves HTTP routes from the merged YAML + DB route set. Hit `GET /health` for a liveness probe,
then seed routes/roles/grants and inspect metrics via the admin and ACL endpoints.

---

## Postman

A ready-made collection is included: **`gateway-db.postman_collection.json`** (in this folder). Import it to
exercise the ACL management, gateway-admin route/auth/metrics, and reload endpoints against the running gateway.

---

## Dependencies

- Pins `@open-rlb/nestjs-amqp` at `^2.0.5`. When run **in-tree** inside this monorepo, it resolves to the
  local workspace library rather than the published package.
- The extra dependencies over the in-memory sample are **`@nestjs/mongoose`** and **`mongoose`**, which back
  every persistent store described above.

---

See also: [gateway-in-memory sample](../gateway-in-memory) · [docs/gateway-admin.md](../../../docs/gateway-admin.md) · [docs/acl.md](../../../docs/acl.md)
