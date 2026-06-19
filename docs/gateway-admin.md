***REMOVED*** Gateway-Admin

The **gateway-admin** module is the management plane for an `@open-rlb/nestjs-amqp` HTTP/WebSocket gateway. It turns the gateway into something you can drive at runtime — without restarts and without hand-editing YAML — by exposing a small set of broker actions for:

- **Route management** — create / list / get / update / delete the HTTP paths stored in the DB, plus an `export` responder that the gateway reads on boot and on every reload.
- **Auth-provider management** — name-keyed upsert/list/get/delete of stored authentication providers (in addition to the static `auth-providers[]` in YAML).
- **Metrics** — rolling counters, raw data points, bucketed time-series, a per-call `track` event sink, and a tiny liveness probe for `/health`.
- **Route auto-discovery (consumer side)** — receives route manifests published by your microservices, diffs them against the DB, persists changes, journals them, and broadcasts a reload.

All handlers are decorator-bound to a single broker topic, `rlb-gateway-admin` (`GATEWAY_ADMIN_TOPIC`). The topic name and every action string are fixed in code — **not configurable**. You expose them over HTTP by adding `gateway.paths[]` entries that forward to that topic/action.

---

***REMOVED******REMOVED*** Base features

| Capability | Backed by | Notes |
| --- | --- | --- |
| DB-stored HTTP routes | `GatewayPathService` + `HttpPathRepository` | `id`-keyed CRUD; `export` feeds `gateway.loadConfig.paths`. |
| Stored auth-providers | `GatewayAuthService` + `AuthProviderRepository` | **name-keyed** PUT-upsert (no POST). |
| Request metrics | `GatewayMetricsService` + `HttpMetricRepository` | counters, points, time-series, and the `gw-health` probe. |
| In-proxy metrics hook | `GatewayMetricsHook` / `RLB_GTW_METRICS_HOOK` | runs in the proxy, independent of the broker metrics sink. |
| Route auto-discovery | `RouteSyncService` + `RouteSyncLogRepository` | consumes manifests, diffs/applies/journals, triggers `gw-reload`. |

The module ships the services; **you** supply the concrete repositories (any backing store — Mongo, in-memory, …) via DI.

---

***REMOVED******REMOVED*** Nest config — `GatewayAdminModule`

`GatewayAdminModule.forRoot(providers, options)` takes the repository bindings as its **first** argument and the module options as its **second**. The four bindings it expects are `HttpPathRepository`, `AuthProviderRepository`, `HttpMetricRepository` and `RouteSyncLogRepository`.

```ts
GatewayAdminModule.forRoot([
  { provide: HttpPathRepository,     useExisting: InMemoryHttpPathRepository },
  { provide: AuthProviderRepository, useExisting: InMemoryAuthProviderRepository },
  { provide: HttpMetricRepository,   useExisting: InMemoryHttpMetricRepository },
  // Route auto-discovery journal (consumer side). RouteSyncService itself is wired by the module.
  { provide: RouteSyncLogRepository, useExisting: InMemoryRouteSyncLogRepository },
]),
```

> The repository classes and DI tokens (`HttpPathRepository`, `AuthProviderRepository`, `HttpMetricRepository`, `RouteSyncLogRepository`, `RLB_GTW_METRICS_HOOK`, …) are all re-exported from `@open-rlb/nestjs-amqp`.

The module **exports** `GatewayPathService`, `GatewayAuthService` and `GatewayMetricsService` (handy if another module needs them directly). `RouteSyncService` is wired internally and runs on application bootstrap.

***REMOVED******REMOVED******REMOVED*** `forRootAsync` — consumer-side `routeDiscovery`

Use `forRootAsync` when you need to resolve options from config (e.g. `ConfigService`). The only option that matters today is the **consumer-side** `routeDiscovery { exchange, queue }` — the exchange/queue the gateway listens on for microservice manifests. These names **must match** the publishers' `broker.routeDiscovery` values.

```ts
GatewayAdminModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    routeDiscovery: {
      exchange: config.get('routeDiscovery.exchange'), // default 'rlb-route-discovery'
      queue:    config.get('routeDiscovery.queue'),    // default 'rlb-route-sync'
    },
  }),
  providers: [
    { provide: HttpPathRepository,     useExisting: InMemoryHttpPathRepository },
    { provide: AuthProviderRepository, useExisting: InMemoryAuthProviderRepository },
    { provide: HttpMetricRepository,   useExisting: InMemoryHttpMetricRepository },
    { provide: RouteSyncLogRepository, useExisting: InMemoryRouteSyncLogRepository },
  ],
}),
```

`GatewayAdminModuleOptions`:

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `topic` | `string` | `'rlb-gateway-admin'` | Topic the handlers bind to (leave default). |
| `routeDiscovery.exchange` | `string` | `'rlb-route-discovery'` | Fanout exchange the gateway consumes manifests from. |
| `routeDiscovery.queue` | `string` | `'rlb-route-sync'` | Durable shared work-queue (competing consumers). |

The consumer side has **no `serviceName`** — the gateway only *receives* manifests and keeps its own `connection_name`. (The `serviceName` lives on the publisher side; see [Route auto-discovery](***REMOVED***route-auto-discovery).)

---

***REMOVED******REMOVED*** YAML config

***REMOVED******REMOVED******REMOVED*** Declare the broker topic + queue

The gateway-admin handlers consume from a topic that must be named **literally** `rlb-gateway-admin`, backed by a durable queue of the same name:

```yaml
broker:
  queues:
    ***REMOVED*** Queue consumed by the gateway-admin backend handlers.
    - name: rlb-gateway-admin
      exchange: rlb
      routingKey: rlb-gateway-admin
      createQueueIfNotExists: true
      options:
        durable: true

topics:
  ***REMOVED*** Topic the gateway-admin handlers bind to (GATEWAY_ADMIN_TOPIC = 'rlb-gateway-admin').
  - name: rlb-gateway-admin
    mode: rpc
    queue: rlb-gateway-admin
    exchange: rlb
    routingKey: rlb-gateway-admin
```

***REMOVED******REMOVED******REMOVED*** Point `loadConfig.paths` at the export responder

So the gateway loads its DB-stored routes (in addition to the YAML `gateway.paths`) at boot and on every reload, point `gateway.loadConfig.paths` at the `gw-path-export` responder:

```yaml
gateway:
  loadConfig:
    paths:
      topic: rlb-gateway-admin
      action: gw-path-export
```

DB routes are merged with the YAML routes and ordered **static-before-param**. Seed via `POST /admin/paths`, then trigger a reload (`POST /admin/reload`) — no restart needed.

---

***REMOVED******REMOVED*** Route management — `gw-path-*` (id-keyed)

`GatewayPathService` stores `PathDefinition`-shaped routes in the DB. Records are keyed by `id`. `create` validates `name` / `method` / `path` / `topic` and rejects a `(method, path)` collision with another enabled route (409). `export` returns all **enabled** paths, ordered static-before-param, and is what `loadConfig.paths` reads.

Wire them as HTTP routes (matches `config.yaml`):

| Method | Path | Action | dataSource | Notes |
| --- | --- | --- | --- | --- |
| `POST`   | `/admin/paths`        | `gw-path-create` | `body`  | requires `name`, `method`, `path`, `topic`; 409 on route collision |
| `GET`    | `/admin/paths`        | `gw-path-list`   | `query` | paginated (`?page=&limit=`) |
| `GET`    | `/admin/paths/export` | `gw-path-export` | `query` | enabled paths, ordered; used by `loadConfig.paths` |
| `PUT`    | `/admin/paths`        | `gw-path-update` | `body`  | requires `id`; keeps `routeKey` in sync, re-checks collisions |
| `GET`    | `/admin/paths/get`    | `gw-path-get`    | `query` | `?id=` |
| `DELETE` | `/admin/paths`        | `gw-path-delete` | `body`  | `{ id }` |

> Note `gw-path-create` is a **POST** (paths *do* have an `id`). This is different from the ACL and auth-provider resources, which are name-keyed PUT-upserts.

---

***REMOVED******REMOVED*** Auth-provider management — `gw-auth-*` (name-keyed PUT-upsert)

`GatewayAuthService` manages stored auth-providers. These have **no `id`** — they are keyed by `name`. There is **no POST**: a single `PUT` creates-or-updates by name (`upsertByName`). `upsert` validates `name` and `type`. `export` returns all enabled providers (read in addition to / for the frontend).

| Method | Path | Action | dataSource | Notes |
| --- | --- | --- | --- | --- |
| `GET`    | `/admin/auth`     | `gw-auth-list`   | `query` | paginated (`?page=&limit=`) |
| `PUT`    | `/admin/auth`     | `gw-auth-update` | `body`  | upsert by name; `{ name, type, ... }` |
| `GET`    | `/admin/auth/get` | `gw-auth-get`    | `query` | `?name=` |
| `DELETE` | `/admin/auth`     | `gw-auth-delete` | `body`  | `{ name }` |

There is also `gw-auth-export` (not exposed in the sample YAML) for dumping all enabled providers.

> The **static** `auth-providers[]` you declare in YAML are documented on the [Gateway page](./gateway.md). The `gw-auth-*` actions here manage the *DB-stored* providers on top of those.

---

***REMOVED******REMOVED*** Metrics

`GatewayMetricsService` records and serves per-request metrics. The gateway can auto-emit a `track` event after every request (configured under `gateway.metrics`), so you normally never call `track` by hand.

| Method | Path | Action | mode | dataSource | Returns |
| --- | --- | --- | --- | --- | --- |
| `GET`  | `/admin/metrics`        | `gw-metrics-get`    | `rpc`   | `query` | counters per route (`count`, `errorCount`, `avgDurationMs`); `?route=` to filter |
| `GET`  | `/admin/metrics/series` | `gw-metrics-series` | `rpc`   | `query` | time-series buckets over `bucketMs`-wide windows |
| `GET`  | `/admin/metrics/points` | `gw-metrics-points` | `rpc`   | `query` | raw data points, newest first |
| `POST` | `/admin/metrics/track`  | `gw-metrics-track`  | `event` | `body`  | fire-and-forget per-call event sink |

- **`gw-metrics-get`** — aggregated counters for a dashboard (count / errors / average duration per route).
- **`gw-metrics-series`** — bucketed aggregates. Params: `bucketMs` (default `60000`), `from`, `to`, `method`, `route`, `name`. Returns `MetricSeriesBucket[]` (`bucketStart`, `count`, `errorCount`, `avgDurationMs`, …).
- **`gw-metrics-points`** — raw `HttpMetricPoint[]`. Params: `method`, `route`, `from`, `to`, `limit`.
- **`gw-metrics-track`** — `mode: event` (fire-and-forget). Increments the rolling counters **and** appends a raw data point. This is the action you wire under `gateway.metrics`:

```yaml
gateway:
  metrics:
    topic: rlb-gateway-admin
    action: gw-metrics-track
```

***REMOVED******REMOVED******REMOVED*** `/health` → `gw-health`

`/health` maps to the **`gw-health`** action, which returns a tiny `{ status: 'ok' }` — a real 200 liveness probe, **not** a metrics dump:

```yaml
- name: health
  method: GET
  path: /health
  dataSource: query
  topic: rlb-gateway-admin
  action: gw-health
  mode: rpc
```

***REMOVED******REMOVED******REMOVED*** In-proxy metrics hook — `RLB_GTW_METRICS_HOOK` / `GatewayMetricsHook`

Independently of the broker-based `gateway.metrics` sink, the gateway invokes an optional **in-proxy hook once per served request, after the response is flushed**. Register an implementation under the `RLB_GTW_METRICS_HOOK` token in `ProxyModule.forRootAsync`'s `providers`. Both sinks can be active at once; the hook must not throw and should be cheap/async.

```ts
export interface GatewayMetricsHook {
  track(point: GatewayMetricPoint): void | Promise<void>;
}

// GatewayMetricPoint: { ts, method, route, name?, topic?, action?, mode?, status?, durationMs? }
```

Wire it:

```ts
ProxyModule.forRootAsync({
  // ...
  providers: [
    { provide: RLB_GTW_METRICS_HOOK, useClass: InfluxMetricsHook },
  ],
}),
```

**Example — write each call straight to InfluxDB** (v2 write API + line protocol over HTTP, no extra dependency). It is a no-op until configured, so the app boots fine without an InfluxDB instance:

```ts
@Injectable()
export class InfluxMetricsHook implements GatewayMetricsHook {
  private readonly url = process.env.INFLUX_URL;
  private readonly token = process.env.INFLUX_TOKEN;
  private readonly org = process.env.INFLUX_ORG;
  private readonly bucket = process.env.INFLUX_BUCKET || 'gateway';

  constructor(private readonly http: HttpService) {}

  async track(point: GatewayMetricPoint): Promise<void> {
    if (!(this.url && this.token && this.org)) return; // no-op until configured
    const writeUrl =
      `${this.url.replace(/\/$/, '')}/api/v2/write` +
      `?org=${encodeURIComponent(this.org)}&bucket=${encodeURIComponent(this.bucket)}&precision=ns`;
    await lastValueFrom(this.http.post(writeUrl, this.toLineProtocol(point), {
      headers: { Authorization: `Token ${this.token}`, 'Content-Type': 'text/plain; charset=utf-8' },
      timeout: 4000,
    }));
  }
  // measurement `http_request`, tags=method/route/status/mode/action, fields=duration_ms+count, ns ts
}
```

Enable with: `INFLUX_URL=http://localhost:8086 INFLUX_TOKEN=<token> INFLUX_ORG=<org> INFLUX_BUCKET=gateway`.

---

***REMOVED******REMOVED*** Route auto-discovery

Route auto-discovery lets a **microservice announce its own HTTP routes** to the gateway, which then persists and registers them automatically — no YAML edits. It has two halves that must agree on the same exchange/queue.

***REMOVED******REMOVED******REMOVED*** Publisher (microservice → gateway)

The publisher (`RouteDiscoveryPublisherService`) lives in **`BrokerModule`**, so any microservice can announce itself. Its config lives **inside the broker block** as `broker.routeDiscovery`:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `serviceName` | `string` | — | **Required to publish**; the ownership key for this service's routes. Also fills `connection_name` if that isn't already set. |
| `publishOnBoot` | `boolean` | `true` | Announce the manifest automatically on bootstrap. |
| `exchange` | `string` | `'rlb-route-discovery'` | Fanout exchange the manifest is published to. |
| `queue` | `string` | `'rlb-route-sync'` | Durable shared work-queue the gateway consumes from. |

```yaml
broker:
  ***REMOVED*** ... uri, exchanges, queues ...
  routeDiscovery:
    serviceName: demo-ms
    publishOnBoot: true
    ***REMOVED*** exchange/queue default to rlb-route-discovery / rlb-route-sync; override to namespace per env.
```

On bootstrap (when `serviceName` is set and `publishOnBoot !== false`), the publisher maps this app's `@BrokerHTTP` / `@BrokerAction` / `@BrokerAuth` metadata into a `RouteManifest` and publishes it as a **durable, persistent** message. Each route in the manifest carries its own auth, declared with `@BrokerAuth` and paired to that route **by name** (see the per-route auth model in [Broker](./broker.md)). The durable queue buffers the manifest even if no gateway consumer is up yet — it's delivered once one connects.

Routes are declared with `@BrokerHTTP` on top of a `@BrokerAction` method; auth stays decoupled in `@BrokerAuth`, which pairs to a route by `httpName` === that route's `name`:

```ts
@Injectable()
export class RouteDiscoveryDemoService {
  @BrokerAction('demo-ms', 'demo.echo', 'rpc')
  @BrokerHTTP('POST', '/demo-ms/echo', 'body', { successStatusCode: 200 })
  @BrokerHTTP('GET', '/health', 'query') // collides with the YAML /health → route-sync skips + logs it
  echo(@BrokerParam('body-full') body: any) {
    return { echo: body ?? null, handledBy: 'demo-ms' };
  }
}
```

A single `@BrokerHTTP` auto-pairs its `@BrokerAuth` (no `name`/`httpName` needed). When ONE action is exposed over **two routes with different auth**, give each `@BrokerHTTP` a `name` and point each `@BrokerAuth` at it via `httpName` — the manifest then carries each route's auth independently:

```ts
@BrokerAction('booking', 'get-booking')
@BrokerHTTP('GET', '/bookings/:id',       'params', { name: 'get-booking' })
@BrokerAuth('cust-jwks', true, undefined, 'get-booking')          // public-ish: anonymous allowed
@BrokerHTTP('GET', '/admin/bookings/:id', 'params', { name: 'admin-get-booking' })
@BrokerAuth('admin-jwks', undefined, ['admin'], 'admin-get-booking') // admins only
getBooking(@BrokerParam('tag', 'id') id: string) { /* ... */ }
```

> A route with no paired `@BrokerAuth` is **public**. With multiple `@BrokerHTTP`, an `@BrokerAuth` whose `httpName` matches no route is NOT applied and logs a warning at microservice startup.

> The gateway must declare the microservice's broker **topic** in its own broker config (queue + topic) so it can route forwarded calls to the service.

***REMOVED******REMOVED******REMOVED*** Consumer (gateway ← microservice)

The consumer (`RouteSyncService`) is wired by `GatewayAdminModule`. On bootstrap it asserts the fanout exchange and subscribes to the durable queue (**competing consumers** — one gateway instance processes each manifest). Its exchange/queue come from the `GatewayAdminModule` `routeDiscovery { exchange, queue }` option and **must match the publishers'** `broker.routeDiscovery`.

For each manifest it:

1. **Diffs** the incoming routes against the DB scoped to the publishing service (route identity = `method + path`).
2. **Applies** only what changed: insert/update new routes; soft-disable stale ones (`enabled: false`). Routes that collide with a YAML route or with another owner's route are **skipped** (the existing owner keeps the `(method, path)`).
3. **Journals** every change via `RouteSyncLogRepository` — one row per `added` / `updated` / `removed` / `collision` / `invalid` / `reload` event.
4. **Triggers a reload** when anything changed, by publishing the canonical **`gw-reload`** action (`GW_RELOAD_ACTION`) to `gateway.reloadTopic`. The gateway's control-topic subscriber rebuilds its routes **only** for `gw-reload`, so it stays decoupled from any other control traffic.

The handler never throws — errors are logged and the message is acked (no poison loop). An empty manifest for a service that has existing routes soft-disables them all (and logs a warning), so a mis-firing publisher is visible in the journal rather than silently destructive.

> The topic names `rlb-acl` / `rlb-gateway-admin` and all action strings (`gw-path-*`, `gw-auth-*`, `gw-metrics-*`, `gw-health`, `gw-reload`) are decorator-bound and **not configurable**. Only the route-discovery `exchange` / `queue` are configurable — and they must match on both sides.

---

See also: [Gateway](./gateway.md) · [Broker](./broker.md) · [ACL](./acl.md) · [Gotchas](./gotchas.md)

← [Back to index](./README.md)
