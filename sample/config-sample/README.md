***REMOVED*** config-sample

Reference configs and runnable sample projects for **@open-rlb/nestjs-amqp**. Use this folder to learn the YAML shape of each module and to see the moving parts wired together end to end.

It holds two kinds of things:

***REMOVED******REMOVED*** (a) Reference configs — copy/paste building blocks

Four annotated, single-module config fragments. Each is a self-contained reference for one module's YAML — read it, lift the block you need, drop it into your own `config.yaml`.

| File | Module | What it documents |
| --- | --- | --- |
| `broker.yaml` | broker | The AMQP core: `broker` connection, `exchanges`, `queues`, `topics` (`rpc` / `broadcast` / `event`), and the publisher-side `broker.routeDiscovery` block. |
| `gateway.yaml` | proxy / gateway | The HTTP/WebSocket edge: `gateway.paths[]`, `gateway.events[]`, `auth`, `actions`, `dataSource`, `loadConfig`, `reloadTopic`, `metrics`. |
| `acl.yaml` | acl | Role-based authorization: name-keyed actions/roles, per-user grants, the single `acl-check-action` authorization check. |
| `gateway-admin.yaml` | gateway-admin | DB-managed routes and auth-providers, metrics with time-series rollups, the route-sync receiver, and the `gw-health` probe. |

These are reference fragments, not whole apps — combine the blocks you need into one `config.yaml`.

***REMOVED******REMOVED******REMOVED*** What is and is not configurable

- **NOT configurable** (decorator-bound in the library): the control topic **names** `rlb-acl`, `rlb-gateway-admin`, `rlb-gateway-control`, and the **action strings** they carry (e.g. `acl-action-update`, `gw-path-export`, `gw-reload`, `gw-health`). Your config binds to them; it cannot rename them.
- **Configurable**: every `exchange`, `queue`, and `routingKey`, and — for route auto-discovery — the discovery `exchange` / `queue` (defaults `rlb-route-discovery` / `rlb-route-sync`; override to namespace per environment).
- **Route-discovery (publisher side)** lives **inside** the `broker` block as `broker.routeDiscovery`. Its `serviceName` is the ownership key a gateway uses to group/replace a microservice's routes, and it **promotes to the AMQP `connection_name`** when no `clientProperties.connection_name` is set explicitly.

***REMOVED******REMOVED*** (b) Sample projects — runnable

Four full NestJS projects. Each has its own README with run instructions.

| Sample | Purpose / use-case | Modules exercised |
| --- | --- | --- |
| [`gateway-in-memory`](./gateway-in-memory/README.md) | Gateway with ACL + gateway-admin kept entirely in RAM (in-memory repositories, in-RAM ACL L2 cache). Only RabbitMQ required — no database. Also doubles as a route-discovery demo microservice. | broker, proxy/gateway, acl, gateway-admin, route-discovery |
| [`gateway-db`](./gateway-db/README.md) | Gateway backed by MongoDB (persistent routes / auth-providers / ACL / metrics) with an InfluxDB time-series metrics hook. | broker, proxy/gateway, acl, gateway-admin (DB-backed), metrics |
| [`gateway-hardening`](./gateway-hardening/README.md) | Focused sample wiring **only** the multi-instance hardening features: cross-instance ACL cache invalidation (AMQP broadcast), bounded ACL RAM cache, an optional scheduler lock for the rollup/retention jobs, and an HTTP body-size limit + in-flight concurrency cap. In-memory stores — only RabbitMQ required. | broker, proxy/gateway, acl, gateway-admin |
| [`calculator.ms`](./calculator.ms/README.md) | A pure AMQP microservice (no HTTP listener — `app.init()`, reachable over the broker) that announces its `@BrokerHTTP` routes to a gateway via route auto-discovery on boot. | broker, route-discovery (publisher) |

***REMOVED******REMOVED*** Versioning & how the samples resolve the library

All four samples target **`@open-rlb/nestjs-amqp` `^2.0.5`** — the next release, currently on `master`.

- **Inside this monorepo** they run against the **local workspace library** (`libs/rlb-nestjs-amqp`), not a published package. Launch them from VS Code:
  - **Debug gateway-in-memory (in-memory stores)**
  - **Debug gateway-db (MongoDB)**
  - **Debug gateway-hardening (multi-instance features)** — plus its **two-instance** compound for the cross-instance ACL invalidation demo.
  - **Debug calculator.ms (microservice)**
  - **Debug all samples** — the compound that starts the core three at once.

  They are also registered as nest-cli projects in the root `nest-cli.json` (`gateway-in-memory`, `gateway-db`, `gateway-hardening`, `calculator.ms`), so `nest build <project>` / `nest start <project>` work from the repo root.
- **Copied out standalone** (outside the monorepo), each project installs the published `@open-rlb/nestjs-amqp` package per its own `package.json` and runs with the usual `npm install` + `npm run start`.

***REMOVED******REMOVED*** Placeholders

The reference configs and sample configs use placeholders for anything environment-specific — replace them with your own values: `amqp://localhost:5672/`, `localhost:27017`, `https://auth.example.com/realms/demo`, `REPLACE_ME`. Never commit real hostnames or secrets.

***REMOVED******REMOVED*** See also

- [Library documentation](../../docs/README.md) — full reference for broker, gateway, ACL, gateway-admin, getting-started and gotchas.
