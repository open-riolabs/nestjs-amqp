# @open-rlb/nestjs-amqp

A NestJS toolkit for building RabbitMQ/AMQP microservices behind a configurable HTTP and WebSocket gateway. It bundles an AMQP messaging core (RPC, fire-and-forget events, broadcast), an edge proxy that maps HTTP routes and WebSocket events onto broker actions, a role-based ACL with a two-level cache, a gateway-admin backend for DB-managed routes and auth-providers, runtime route auto-discovery (microservices announce their own HTTP routes), and request metrics. Most services are declared with a few decorators and a YAML config file; the runtime wires the queues, exchanges, bindings, auth and routing for you.

## Pages

- [Getting started](./getting-started.md) — install, bootstrap a microservice and a gateway, the minimal `config.yaml`.
- [Broker](./broker.md) — the AMQP core: `@BrokerAction` / `@BrokerParam`, topics, RPC vs event vs broadcast, the `BrokerService` API.
- [Gateway](./gateway.md) — the HTTP/WebSocket edge: `gateway.paths[]`, `gateway.events[]`, auth, roles, data sources, runtime reload.
- [ACL](./acl.md) — action-based authorization: name-keyed actions/roles, per-user grants, the `acl-check-action` check, the two-level cache.
- [Gateway-admin](./gateway-admin.md) — DB-managed routes and auth-providers, metrics, route-sync receiver, health probe.
- [Gotchas](./gotchas.md) — the sharp edges: control-topic semantics, name-keyed CRUD, 204-vs-200, exchange/queue naming across sides.
- [YAML migration scripts](./yaml-migration.md) — migrate `gateway.paths[]` into the gateway-admin DB (`gateway-paths-to-http.js`) and stamp `@BrokerHTTP`/`@BrokerAuth` into microservice code for auto-discovery (`broker-http-decorators.js`).

## Install

```bash
npm install @open-rlb/nestjs-amqp
```

Current package version: `0.0.1`.

## Import paths

Almost everything you use day-to-day comes from the package root:

```ts
import {
  BrokerModule,
  BrokerService,
  BrokerAction,
  BrokerParam,
  AclModule,
  GatewayAdminModule,
  ProxyModule,
} from '@open-rlb/nestjs-amqp';
```

The low-level AMQP connection layer (rarely imported directly) has its own subpath:

```ts
import { /* low-level connection primitives */ } from '@open-rlb/nestjs-amqp/amqp-lib';
```

## Library & modules

**broker** — the AMQP core. You decorate service methods with `@BrokerAction('topic', 'action')` and bind handler arguments with `@BrokerParam`; the runtime subscribes them to the configured topics and dispatches incoming messages. `BrokerService` is the client side: it does RPC calls (wait for a reply), publishes events (fire-and-forget with publish confirm), and broadcasts. Topics, queues, exchanges and bindings are declared in the YAML `broker`/`topics` blocks. Topic names and action strings are decorator-bound and not configurable. See [Broker](./broker.md).

**proxy / gateway** — the HTTP and WebSocket edge. The `ProxyModule` turns `gateway.paths[]` entries into Express routes that forward each request to a broker `topic` + `action` (RPC or event), pulling the payload from `body`/`query`/`params` per `dataSource`, applying `auth` (an auth-provider) and `roles`. `gateway.events[]` pushes broker messages out to authenticated WebSocket clients (or webhooks). Routes can be rebuilt at runtime without a restart. See [Gateway](./gateway.md).

**acl** — action-based authorization. Actions and roles are name-keyed (PUT upserts, GET lists, DELETE by name); per-user grants tie a `userId` to a set of `roles`, scoped to a `(companyId, resourceId)` target (both load-bearing in the auth decision — exact match, no wildcard). The single check `acl-check-action` (`checkAction(userId, ctx, action)`) resolves the requested action(s) to roles and verifies the user's grants, returning a plain boolean; the gateway runs it in-process to gate routes by `actions`. A two-level cache keeps hot lookups fast. See [ACL](./acl.md).

**gateway-admin** — the management backend. It stores gateway routes and auth-providers in a database (both exposed over the broker; auth-providers are name-keyed PUT-upserts), records request metrics with time-series rollups, and runs the route-sync receiver that consumes route manifests auto-published by microservices on boot. It also serves the `gw-health` liveness probe (`{ status: 'ok' }`). See [Gateway-admin](./gateway-admin.md).

**amqp-lib** — the low-level connection layer (`@open-rlb/nestjs-amqp/amqp-lib`) that manages the underlying `amqp-connection-manager` channels, reconnection and connection options. You rarely touch this directly; the higher-level modules sit on top of it.

**common** — shared building blocks: typed errors and pagination helpers used across the other modules.
