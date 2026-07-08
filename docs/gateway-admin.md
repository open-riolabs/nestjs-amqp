# Gateway-Admin

The **gateway-admin** module is the management plane for an `@open-rlb/nestjs-amqp` HTTP/WebSocket gateway. It turns the gateway into something you can drive at runtime — without restarts and without hand-editing YAML — by exposing a small set of broker actions for:

- **Route management** — create / list / get / update / delete the HTTP paths stored in the DB, plus an `export` responder that the gateway reads on boot and on every reload.
- **Auth-provider management** — name-keyed upsert/list/get/delete of stored authentication providers (in addition to the static `auth-providers[]` in YAML).
- **Metrics** — rolling counters, raw data points, bucketed time-series, a per-call `track` event sink, and a tiny liveness probe for `/health`.
- **Route auto-discovery (consumer side)** — receives route manifests published by your microservices, diffs them against the DB, persists changes, journals them, and broadcasts a reload.

All handlers are decorator-bound to a single broker topic, `rlb-gateway-admin` (`GATEWAY_ADMIN_TOPIC`). The topic name and every action string are fixed in code — **not configurable**. You expose them over HTTP by adding `gateway.paths[]` entries that forward to that topic/action.

---

## Base features

| Capability | Backed by | Notes |
| --- | --- | --- |
| DB-stored HTTP routes | `GatewayPathService` + `HttpPathRepository` | `id`-keyed CRUD; `export` feeds `gateway.loadConfig.paths`. |
| Stored auth-providers | `GatewayAuthService` + `AuthProviderRepository` | **name-keyed** PUT-upsert (no POST). |
| Request metrics | `GatewayMetricsService` + `HttpMetricRepository` | counters, points, time-series, and the `gw-health` probe. |
| In-proxy metrics hook | `GatewayMetricsHook` / `RLB_GTW_METRICS_HOOK` | runs in the proxy, independent of the broker metrics sink. |
| Route auto-discovery | `RouteSyncService` + `RouteSyncLogRepository` | consumes manifests, diffs/applies/journals, triggers `gw-reload`. |

The module ships the services; **you** supply the concrete repositories (any backing store — Mongo, in-memory, …) via DI.

---

## Nest config — `GatewayAdminModule`

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

> **New contract methods consumers must implement.** The repository contracts gained methods to support paginated search, the filtered journal query, and retention pruning:
> - **`*Repository.search(q?, page?, limit?)`** now returns `Promise<PaginationModel<T>>` (`{ page, limit, total, data }`) instead of a bare array — applies to `HttpPathRepository` and `AuthProviderRepository` (and the ACL repos).
> - **`RouteSyncLogRepository.query(filter, page?, limit?)`** — filtered + paginated journal query (`filter`: `actor`, `service`, `event`, `routeKey`, `from`, `to`), returns `PaginationModel<RouteSyncLogEntry>`. Backs `gw-route-log-search`.
> - **`RouteSyncLogRepository.prune(olderThanTs)`** and **`HttpMetricRepository.prunePoints(olderThanTs)`** — delete journal rows / raw metric points older than the timestamp. Called by the daily retention job (see `retentionDays`).

The module **exports** `GatewayPathService`, `GatewayAuthService` and `GatewayMetricsService` (handy if another module needs them directly). `RouteSyncService` is wired internally and runs on application bootstrap.

### `forRootAsync` — consumer-side `routeDiscovery`

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
| `retentionDays` | `number` | `90` | Retention window (≈3 months) for the route journal + raw metric points. A daily job (`GatewayRetentionService`) prunes anything older. Set `0`/negative to disable. |
| `rollupRetentionDays` | `number` | `365` | Retention window (≈1 year) for the persisted hourly metric **rollups** (long-term trends that survive raw-point pruning). When `> 0` the hourly rollup job (`GatewayMetricsRollupService`) runs and old rollups are pruned at this window; `0`/negative disables rollups. |

The consumer side has **no `serviceName`** — the gateway only *receives* manifests and keeps its own `connection_name`. (The `serviceName` lives on the publisher side; see [Route auto-discovery](#route-auto-discovery).)

---

## YAML config

### Declare the broker topic + queue

The gateway-admin handlers consume from a topic that must be named **literally** `rlb-gateway-admin`, backed by a durable queue of the same name:

```yaml
broker:
  queues:
    # Queue consumed by the gateway-admin backend handlers.
    - name: rlb-gateway-admin
      exchange: rlb
      routingKey: rlb-gateway-admin
      createQueueIfNotExists: true
      options:
        durable: true

topics:
  # Topic the gateway-admin handlers bind to (GATEWAY_ADMIN_TOPIC = 'rlb-gateway-admin').
  - name: rlb-gateway-admin
    mode: rpc
    queue: rlb-gateway-admin
    exchange: rlb
    routingKey: rlb-gateway-admin
```

### Point `loadConfig.paths` at the export responder

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

## Route management — `gw-path-*` (id-keyed)

`GatewayPathService` stores `PathDefinition`-shaped routes in the DB. Records are keyed by `id`. `create` validates `name` / `method` / `path` / `topic` and rejects a `(method, path)` collision with another enabled route (409). `export` returns all **enabled** paths, ordered static-before-param, and is what `loadConfig.paths` reads.

Wire them as HTTP routes (matches `config.yaml`):

| Method | Path | Action | dataSource | Notes |
| --- | --- | --- | --- | --- |
| `POST`   | `/admin/paths`        | `gw-path-create` | `body`  | requires `name`, `method`, `path`, `topic`; 409 on route collision |
| `GET`    | `/admin/paths`        | `gw-path-list`   | `query` | paginated (`?page=&limit=`) |
| `GET`    | `/admin/paths/search` | `gw-path-search` | `query` | free-text search → `PaginationModel<StoredHttpPath>`; `?q=&page=&limit=` |
| `GET`    | `/admin/paths/export` | `gw-path-export` | `query` | enabled paths, ordered; used by `loadConfig.paths` |
| `PUT`    | `/admin/paths`        | `gw-path-update` | `body`  | requires `id`; keeps `routeKey` in sync, re-checks collisions |
| `GET`    | `/admin/paths/get`    | `gw-path-get`    | `query` | `?id=` |
| `DELETE` | `/admin/paths`        | `gw-path-delete` | `body`  | `{ id }` |
| `GET`    | `/admin/route-log`    | `gw-route-log-list`   | `query` | route-change journal (`actor` = `system` \| userId, `+/−` per-field diff); `?limit=` |
| `GET`    | `/admin/route-log/search` | `gw-route-log-search` | `query` | filtered + paginated journal query → `PaginationModel<RouteSyncLogEntry>`; `?actor=&service=&event=&routeKey=&from=&to=&page=&limit=` |

> Note `gw-path-create` is a **POST** (paths *do* have an `id`). This is different from the ACL and auth-provider resources, which are name-keyed PUT-upserts.

---

## Auth-provider management — `gw-auth-*` (name-keyed PUT-upsert)

`GatewayAuthService` manages stored auth-providers. These have **no `id`** — they are keyed by `name`. There is **no POST**: a single `PUT` creates-or-updates by name (`upsertByName`). `upsert` validates `name` and `type`. `export` returns all enabled providers (read in addition to / for the frontend).

| Method | Path | Action | dataSource | Notes |
| --- | --- | --- | --- | --- |
| `GET`    | `/admin/auth`     | `gw-auth-list`   | `query` | paginated (`?page=&limit=`) |
| `GET`    | `/admin/auth/search` | `gw-auth-search` | `query` | free-text search → `PaginationModel<StoredAuthProvider>`; `?q=&page=&limit=` |
| `PUT`    | `/admin/auth`     | `gw-auth-update` | `body`  | upsert by name; `{ name, type, ... }` |
| `GET`    | `/admin/auth/get` | `gw-auth-get`    | `query` | `?name=` |
| `DELETE` | `/admin/auth`     | `gw-auth-delete` | `body`  | `{ name }` |

There is also `gw-auth-export` (not exposed in the sample YAML) for dumping all enabled providers.

> The **static** `auth-providers[]` you declare in YAML are documented on the [Gateway page](./gateway.md). The `gw-auth-*` actions here manage the *DB-stored* providers on top of those.

---

## Metrics

`GatewayMetricsService` records and serves per-request metrics. The gateway can auto-emit a `track` event after every request (configured under `gateway.metrics`), so you normally never call `track` by hand.

> **Isolate the track traffic.** `gw-metrics-track` fires once per HTTP request and does DB
> writes: on the shared `rlb-gateway-admin` queue a slow metrics store fills the consumer's
> prefetch slots and starves `gw-health`, `gw-reload` and every admin RPC. The handler is also
> bound to the **optional dedicated topic `rlb-gateway-metrics`**: declare that topic (+ its own
> queue, ideally with `maxLength`/`messageTtl` — metrics are droppable telemetry) in the broker
> config and point `gateway.metrics.topic` at it. When the topic isn't configured, the binding
> is simply skipped and everything keeps working on the admin topic. The `track` handler never
> throws (fail-soft): a metrics DB outage costs data points, never the flow.

| Method | Path | Action | mode | dataSource | Returns |
| --- | --- | --- | --- | --- | --- |
| `GET`  | `/admin/metrics`            | `gw-metrics-get`        | `rpc`   | `query` | counters per route (`count`, `errorCount`, `avgDurationMs`, `errorRate`, `lastErrorCode`); `?route=` to filter |
| `GET`  | `/admin/metrics/series`     | `gw-metrics-series`     | `rpc`   | `query` | time-series buckets (count/errors/avg·min·max + **p50/p95/p99** + `byStatus`) |
| `GET`  | `/admin/metrics/points`     | `gw-metrics-points`     | `rpc`   | `query` | raw data points, newest first |
| `GET`  | `/admin/metrics/summary`    | `gw-metrics-summary`    | `rpc`   | `query` | dashboard overview: totals, error rate, percentiles, status breakdown, top-N |
| `GET`  | `/admin/metrics/prometheus` | `gw-metrics-prometheus` | `rpc`   | `query` | Prometheus text exposition of the counters (`text/plain`) |
| `GET`  | `/admin/metrics/rollups`    | `gw-metrics-rollups`    | `rpc`   | `query` | long-term hourly rollups (survive raw-point retention) |
| `POST` | `/admin/metrics/track`      | `gw-metrics-track`      | `event` | `body`  | fire-and-forget per-call event sink |

- **`gw-metrics-get`** — aggregated counters for a dashboard (count / errors / avg duration + **`errorRate`** + **`lastErrorCode`** per route).
- **`gw-metrics-series`** — enriched bucketed aggregates, computed app-side from the raw points. Params: `bucketMs` (default `60000`), `from`, `to`, `method`, `route`, `name`. Returns `MetricSeriesBucket[]` (`bucketStart`, `count`, `errorCount`, `avgDurationMs`, `min/maxDurationMs`, **`p50/p95/p99`**, **`byStatus`** `{2xx,3xx,4xx,5xx}`).
- **`gw-metrics-points`** — raw `HttpMetricPoint[]` (each now carries the error **`code`** from the unified envelope). Params: `method`, `route`, `from`, `to`, `limit`.
- **`gw-metrics-summary`** — dashboard overview computed from the raw points. Params: `from`, `to`, `method`, `route`, `name`, `topN` (default `10`). Returns `MetricSummary`: `totalRequests`, `totalErrors`, `errorRate`, `avgDurationMs`, `p50/p95/p99`, `byStatus`, and the top-N routes by traffic / errors / p95 latency.
- **`gw-metrics-prometheus`** — Prometheus text exposition (v0.0.4) of the rolling counters (`gateway_requests_total`, `gateway_request_errors_total`, `gateway_request_duration_ms_sum`). The route sets `headers: { Content-Type: text/plain }` so the gateway returns it raw. Percentiles need histograms and are not emitted here — use `summary`/`series` for those.
- **`gw-metrics-rollups`** — persisted **hourly** downsampled aggregates (`HttpMetricRollup[]`) that survive raw-point retention, for long-term trends. An hourly job (`GatewayMetricsRollupService`) rolls the previous hour's points up; old rollups are pruned at `rollupRetentionDays`. Params: `from`, `to`, `method`, `route`.
- **`gw-metrics-track`** — `mode: event` (fire-and-forget). Increments the rolling counters (incl. `lastErrorCode`) **and** appends a raw data point (incl. the error `code`). This is the action you wire under `gateway.metrics`:

```yaml
gateway:
  metrics:
    topic: rlb-gateway-admin
    action: gw-metrics-track
```

### `/health` → `gw-health` (readiness probe)

`/health` maps to the **`gw-health`** action — a **readiness** probe (not a metrics dump). It returns:

```json
{
  "status": "up",                                  // 'down' if the broker OR any dependency is down
  "broker": { "status": "up", "detail": "..." },   // AmqpConnection, checked built-in
  "dependencies": {
    "database": { "status": "up", "detail": "..." }
  }
}
```

The broker (AmqpConnection) is checked built-in. DB / redis / external checks are **consumer-supplied**: register indicators under the `RLB_GW_HEALTH_INDICATORS` token.

```ts
import { RLB_GW_HEALTH_INDICATORS, GatewayHealthIndicator } from '@open-rlb/nestjs-amqp';

{
  provide: RLB_GW_HEALTH_INDICATORS,
  useValue: [
    { name: 'database', check: async () => ({ status: 'up' }) },
    // { name: 'redis', check: async () => ({ status: 'down', detail: 'timeout' }) },
  ] satisfies GatewayHealthIndicator[],
}

// interface GatewayHealthIndicator { name: string; check(): Promise<{ status: 'up' | 'down'; detail?: string }> }
```

> The HTTP response is **always `200`** with this body — the gateway forwards an rpc result and can't set `503`. Readiness checks must inspect the `status` field, not the HTTP status.

```yaml
- name: health
  method: GET
  path: /health
  dataSource: query
  topic: rlb-gateway-admin
  action: gw-health
  mode: rpc
```

### In-proxy metrics hook — `RLB_GTW_METRICS_HOOK` / `GatewayMetricsHook`

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

### Retention

Both the route-change journal and the raw metric points grow unbounded otherwise, so a daily job (`GatewayRetentionService`) prunes anything older than `GatewayAdminModuleOptions.retentionDays` (**default `90`** ≈ 3 months). It calls `RouteSyncLogRepository.prune(olderThanTs)` and `HttpMetricRepository.prunePoints(olderThanTs)`. Set `retentionDays` to `0` or a negative number to disable pruning entirely. (Counters and time-series aggregates are not pruned — only the raw points behind them.)

---

## Route auto-discovery

Route auto-discovery lets a **microservice announce its own HTTP routes** to the gateway, which then persists and registers them automatically — no YAML edits. It has two halves that must agree on the same exchange/queue.

### Publisher (microservice → gateway)

The publisher (`RouteDiscoveryPublisherService`) lives in **`BrokerModule`**, so any microservice can announce itself. Its config lives **inside the broker block** as `broker.routeDiscovery`:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `serviceName` | `string` | — | **Required to publish**; the ownership key for this service's routes. Also fills `connection_name` if that isn't already set. |
| `publishOnBoot` | `boolean` | `true` | Announce the manifest automatically on bootstrap. |
| `exchange` | `string` | `'rlb-route-discovery'` | Fanout exchange the manifest is published to. |
| `queue` | `string` | `'rlb-route-sync'` | Durable shared work-queue the gateway consumes from. |

```yaml
broker:
  # ... uri, exchanges, queues ...
  routeDiscovery:
    serviceName: demo-ms
    publishOnBoot: true
    # exchange/queue default to rlb-route-discovery / rlb-route-sync; override to namespace per env.
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

### Consumer (gateway ← microservice)

The consumer (`RouteSyncService`) is wired by `GatewayAdminModule`. On bootstrap it asserts the fanout exchange and subscribes to the durable queue (**competing consumers** — one gateway instance processes each manifest). Its exchange/queue come from the `GatewayAdminModule` `routeDiscovery { exchange, queue }` option and **must match the publishers'** `broker.routeDiscovery`.

For each manifest it:

1. **Diffs** the incoming routes against the DB scoped to the publishing service (route identity = `method + path`).
2. **Applies** only what changed: insert/update new routes; soft-disable stale ones (`enabled: false`). Routes that collide with a YAML route or with another owner's route are **skipped** (the existing owner keeps the `(method, path)`).
3. **Journals** every change via `RouteSyncLogRepository` — one row per `added` / `updated` / `removed` / `skipped` / `collision` / `invalid` / `reload` event. Every row carries an **`actor`** (`'system'` for auto-discovery), and an `updated` row also carries a **`changes`** per-field diff (e.g. `actions: [+booking-read, -admin]`, `timeout: [+1000, -5000]`).
4. **Triggers a reload** when anything changed, by publishing the canonical **`gw-reload`** action (`GW_RELOAD_ACTION`) to `gateway.reloadTopic`. The gateway's control-topic subscriber rebuilds its routes **only** for `gw-reload`, so it stays decoupled from any other control traffic.

The handler never throws — errors are logged and the message is acked (no poison loop). An empty manifest for a service that has existing routes soft-disables them all (and logs a warning), so a mis-firing publisher is visible in the journal rather than silently destructive.

#### Ownership, user edits & audit (`source` / `modified` / `actor`)

Every stored route carries `source` — `'microservice'` (auto-discovered) or `'user'` (created via `gw-path-create`) — and `modified`, set `true` the moment a user edits an auto-discovered route. When a manifest re-announces a route a user has edited, the sync **skips** it (the user's version wins) and journals a `skipped` row with an info log; auto-discovery never overwrites it again.

User route CRUD is audited the same way: `gw-path-create` / `gw-path-update` / `gw-path-delete` each write a journal row with `actor = <userId>` (from the forwarded `X-GTW-AUTH-USERID`, else `'unknown'`), `event` = `created` / `updated` / `deleted`, and — on update — the same `changes` per-field diff. So the journal answers "who changed what": `'system'` for auto-discovery, the user's id for manual edits.

> The topic names `rlb-acl` / `rlb-gateway-admin` and all action strings (`gw-path-*`, `gw-auth-*`, `gw-metrics-*`, `gw-health`, `gw-reload`) are decorator-bound and **not configurable**. Only the route-discovery `exchange` / `queue` are configurable — and they must match on both sides.

---

See also: [Gateway](./gateway.md) · [Broker](./broker.md) · [ACL](./acl.md) · [Gotchas](./gotchas.md)

← [Back to index](./README.md)
