---
name: rlb-amqp-gateway-admin
description: Drive the @open-rlb/nestjs-amqp gateway-admin management plane and route auto-discovery. Use for DB-managed HTTP routes (gw-path-*), DB auth-providers CRUD (gw-auth-*, name-keyed PUT-upsert), gateway metrics (gw-metrics-get/series/points/track) and the gw-health probe, runtime route reload (gw-reload via the broadcast control topic), the in-proxy metrics hook (RLB_GTW_METRICS_HOOK), and wiring GatewayAdminModule.forRoot/forRootAsync. Also covers route auto-discovery: publisher (broker.routeDiscovery serviceName/publishOnBoot/exchange/queue) vs consumer (GatewayAdminModule routeDiscovery exchange/queue).
---

***REMOVED*** Gateway-admin module + route auto-discovery

Read first:
- `docs/gateway-admin.md` (full reference)
- `sample/config-sample/gateway-admin.yaml` (annotated YAML for every action)
- `sample/config-sample/gateway-db/` (runnable wiring; `apps/gateway-2` was retired)

The gateway-admin module is the gateway's management plane: DB-stored routes,
DB auth-providers, metrics, runtime reload, and the consumer side of route
auto-discovery. All handlers bind to the topic `rlb-gateway-admin`
(`GATEWAY_ADMIN_TOPIC`). The topic NAME and every action string are
**decorator-bound — NOT configurable**. You drive them by adding
`gateway.paths[]` that forward to that topic/action.

***REMOVED******REMOVED*** Fixed vs configurable

- FIXED (write exactly): topic names `rlb-gateway-admin`, control action
  `gw-reload`, and all action strings `gw-path-*` / `gw-auth-*` / `gw-metrics-*`
  / `gw-health` (from `GW_ADMIN_ACTIONS` + `GW_RELOAD_ACTION`).
- CONFIGURABLE: each topic's exchange/queue/routingKey, and the route-discovery
  exchange/queue (defaults `rlb-route-discovery` / `rlb-route-sync`) — which must
  match on the publisher AND consumer sides.

***REMOVED******REMOVED*** Nest wiring — `GatewayAdminModule`

`forRoot(providers, options)`: repo bindings FIRST, options SECOND. You supply
the four repositories (any store); the module ships the services and wires
`RouteSyncService` internally. Tokens are re-exported from `@open-rlb/nestjs-amqp`.

```ts
GatewayAdminModule.forRoot([
  { provide: HttpPathRepository,     useExisting: MongoHttpPathRepository },
  { provide: AuthProviderRepository, useExisting: MongoAuthProviderRepository },
  { provide: HttpMetricRepository,   useExisting: MongoHttpMetricRepository },
  { provide: RouteSyncLogRepository, useExisting: MongoRouteSyncLogRepository }, // route-discovery journal
]),
```

Use `forRootAsync` to resolve the **consumer-side** `routeDiscovery { exchange, queue }`
from config (see Route auto-discovery). Exports `GatewayPathService`,
`GatewayAuthService`, `GatewayMetricsService`.

***REMOVED******REMOVED*** Broker topic + queue (required)

```yaml
broker:
  queues:
    - name: rlb-gateway-admin
      exchange: rlb
      routingKey: rlb-gateway-admin
      createQueueIfNotExists: true
      options: { durable: true }
topics:
  - name: rlb-gateway-admin     ***REMOVED*** MUST be this name
    mode: rpc
    queue: rlb-gateway-admin
    exchange: rlb
    routingKey: rlb-gateway-admin
  - name: rlb-gateway-control   ***REMOVED*** name is yours; must match gateway.reloadTopic + gw-reload path
    mode: broadcast
    exchange: rlb
    routingKey: rlb-gateway-control
```

Point `loadConfig.paths` at the export responder so DB routes merge with YAML
`gateway.paths` on boot and on every reload (merged static-before-param):

```yaml
gateway:
  loadConfig:
    paths: { topic: rlb-gateway-admin, action: gw-path-export }
  reloadTopic: rlb-gateway-control
  metrics: { topic: rlb-gateway-admin, action: gw-metrics-track }  ***REMOVED*** auto-emit track per request
```

***REMOVED******REMOVED*** Route management — `gw-path-*` (id-keyed)

`gw-path-create` is a **POST** (DB paths have an `id`) — unlike the name-keyed
auth/ACL resources. `create` rejects a `(method, path)` collision (409).
`export` returns enabled paths, ordered, and feeds `loadConfig.paths`.

| Method | Path | action | dataSource | Notes |
| --- | --- | --- | --- | --- |
| POST   | `/admin/paths`        | `gw-path-create` | body  | needs `name,method,path,topic`; 409 on collision |
| GET    | `/admin/paths`        | `gw-path-list`   | query | `?page=&limit=` |
| GET    | `/admin/paths/export` | `gw-path-export` | query | enabled, ordered; used by `loadConfig.paths` |
| PUT    | `/admin/paths`        | `gw-path-update` | body  | needs `id`; re-checks collisions |
| GET    | `/admin/paths/get`    | `gw-path-get`    | query | `?id=` |
| DELETE | `/admin/paths`        | `gw-path-delete` | body  | `{ id }` |

***REMOVED******REMOVED*** Auth-provider management — `gw-auth-*` (name-keyed PUT-upsert)

No `id`, no POST — a single `PUT` creates-or-updates by `name`. These are the
DB-stored providers, ON TOP of the static `auth-providers[]` in YAML.

| Method | Path | action | dataSource | Notes |
| --- | --- | --- | --- | --- |
| GET    | `/admin/auth`     | `gw-auth-list`   | query | `?page=&limit=` |
| PUT    | `/admin/auth`     | `gw-auth-update` | body  | upsert by name; `{ name, type, ... }` |
| GET    | `/admin/auth/get` | `gw-auth-get`    | query | `?name=` |
| DELETE | `/admin/auth`     | `gw-auth-delete` | body  | `{ name }` |

`gw-auth-export` (dump all enabled) also exists; not in the sample YAML.

***REMOVED******REMOVED*** Metrics — `gw-metrics-*` + `gw-health`

| Method | Path | action | mode | dataSource | Returns |
| --- | --- | --- | --- | --- | --- |
| GET  | `/admin/metrics`        | `gw-metrics-get`    | rpc   | query | counters/route (`count,errorCount,avgDurationMs`); `?route=` |
| GET  | `/admin/metrics/series` | `gw-metrics-series` | rpc   | query | buckets: `?bucketMs=60000&from=&to=&method=&route=&name=` |
| GET  | `/admin/metrics/points` | `gw-metrics-points` | rpc   | query | raw points newest-first: `?method=&route=&from=&to=&limit=` |
| POST | `/admin/metrics/track`  | `gw-metrics-track`  | event | body  | fire-and-forget sink (wired via `gateway.metrics`) |

`gw-health` → `{ status: 'ok' }`, a real 200 liveness probe (NOT a metrics dump):

```yaml
- name: health
  method: GET
  path: /health
  dataSource: query
  topic: rlb-gateway-admin
  action: gw-health
  mode: rpc
```

***REMOVED******REMOVED******REMOVED*** In-proxy metrics hook — `RLB_GTW_METRICS_HOOK`

Independent of the broker `gateway.metrics` sink: the gateway invokes a hook
once per request, after the response is flushed. Register under
`RLB_GTW_METRICS_HOOK` in `ProxyModule.forRootAsync`'s `providers`. Both sinks
can be active; the hook must not throw and should be cheap/async.

```ts
export interface GatewayMetricsHook { track(p: GatewayMetricPoint): void | Promise<void>; }
// GatewayMetricPoint: { ts, method, route, name?, topic?, action?, mode?, status?, durationMs? }

ProxyModule.forRootAsync({ /* ... */ providers: [
  { provide: RLB_GTW_METRICS_HOOK, useClass: InfluxMetricsHook },
]}),
```

(`sample/config-sample/gateway-db` ships an `InfluxMetricsHook` that is a no-op
until `INFLUX_URL/TOKEN/ORG` env are set.)

***REMOVED******REMOVED*** Runtime reload — `gw-reload`

The ONLY control action that forces a route rebuild. Published to the
**broadcast control topic** (`gateway.reloadTopic`, NOT `rlb-gateway-admin`),
`mode: event`. The control-topic subscriber ignores everything except
`gw-reload`, staying decoupled from other control traffic.

```yaml
- name: gw-reload
  method: POST
  path: /admin/reload
  dataSource: body
  topic: rlb-gateway-control   ***REMOVED*** the broadcast control topic
  action: gw-reload
  mode: event
```

Seed DB routes via `POST /admin/paths`, then `POST /admin/reload` — no restart.

***REMOVED******REMOVED*** Route auto-discovery (publisher vs consumer)

A microservice announces its own `@BrokerHTTP`/`@BrokerAction` routes; the
gateway persists + registers them, no YAML edits. Two halves must agree on the
same exchange/queue (defaults `rlb-route-discovery` / `rlb-route-sync`).

***REMOVED******REMOVED******REMOVED*** Publisher (microservice → gateway) — `broker.routeDiscovery`

Lives in `BrokerModule`, so its config is INSIDE the broker block.

| Field | Default | Purpose |
| --- | --- | --- |
| `serviceName`   | —      | **Required to publish**; ownership key. PROMOTES to AMQP `connection_name` if none set. |
| `publishOnBoot` | `true` | Announce manifest on bootstrap (durable/persistent message; queue buffers it). |
| `exchange`      | `rlb-route-discovery` | Fanout exchange the manifest is published to. |
| `queue`         | `rlb-route-sync`      | Durable shared work-queue the gateway consumes. |

```yaml
***REMOVED*** in the MICROSERVICE config.yaml:
broker:
  routeDiscovery:
    serviceName: demo-ms     ***REMOVED*** required; also fills connection_name if unset
    publishOnBoot: true
    ***REMOVED*** exchange/queue default; override only to namespace per env (then match the consumer)
```

Routes are declared `@BrokerHTTP` over a `@BrokerAction` method. The gateway must
still declare the microservice's broker topic so it can route forwarded calls.

***REMOVED******REMOVED******REMOVED*** Consumer (gateway ← microservice) — `GatewayAdminModule` `routeDiscovery`

Wired by `GatewayAdminModule` (NOT YAML). Asserts the fanout exchange, subscribes
to the durable queue (competing consumers), then per manifest: diffs vs DB scoped
to the publishing service, applies only changes (insert/update; soft-disable stale
to `enabled:false`; skip collisions — existing owner keeps `(method,path)`),
journals every event via `RouteSyncLogRepository`, and publishes `gw-reload` when
anything changed. Never throws (acks; no poison loop).

```ts
GatewayAdminModule.forRootAsync({
  imports: [ConfigModule], inject: [ConfigService],
  useFactory: (c: ConfigService) => ({
    routeDiscovery: {
      exchange: c.get('routeDiscovery.exchange'), // default rlb-route-discovery
      queue:    c.get('routeDiscovery.queue'),    // default rlb-route-sync — MUST match publishers
    },
  }),
  providers: [ /* HttpPathRepository, AuthProviderRepository, HttpMetricRepository, RouteSyncLogRepository */ ],
}),
```

The consumer has NO `serviceName` (it only receives). The exchange/queue MUST
match every publisher's `broker.routeDiscovery`.

***REMOVED******REMOVED*** Verify

- Topic `rlb-gateway-admin` (+ queue) declared; `reloadTopic` matches the
  broadcast control topic name and the `gw-reload` path's `topic`.
- Action strings written exactly (`gw-path-*`, `gw-auth-*`, `gw-metrics-*`,
  `gw-health`, `gw-reload`).
- `loadConfig.paths` → `gw-path-export`; `gateway.metrics` → `gw-metrics-track`.
- Route-discovery `exchange`/`queue` identical on publisher and consumer.
- All four repositories bound; `npm run build`.

See also: `rlb-amqp` (schema/gotchas) · `rlb-amqp-add-route` · `docs/gateway.md` · `docs/acl.md`
