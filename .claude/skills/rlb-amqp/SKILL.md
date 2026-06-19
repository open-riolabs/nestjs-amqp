---
name: rlb-amqp
description: Reference, schema and gotchas for the @open-rlb/nestjs-amqp library (NestJS + RabbitMQ/AMQP + HTTP/WebSocket gateway). Use when answering questions about its YAML config (broker incl. routeDiscovery, topics, auth-providers, gateway paths/ws/events), AMQP rpc/handle/broadcast/event semantics, the @BrokerAction/@BrokerParam/@BrokerHTTP/@BrokerAuth decorators, the BrokerService API, route auto-discovery, gateway-admin (routes/auth-providers/metrics/health), the name-keyed ACL, or when debugging wiring/timeout/auth/websocket errors. Shared knowledge base for the rlb-amqp-add-action, rlb-amqp-add-route, rlb-amqp-add-ws-event, rlb-amqp-scaffold, rlb-amqp-acl and rlb-amqp-gateway-admin skills.
---

***REMOVED*** @open-rlb/nestjs-amqp — reference

This library wraps RabbitMQ/AMQP for NestJS microservices and adds an HTTP/WebSocket
API gateway. Business methods are decorated with `@BrokerAction` and wired to the
broker through YAML config. The gateway turns HTTP/WS requests into broker messages.

***REMOVED******REMOVED*** Mental model

```
HTTP/WS → Gateway (gateway.paths / gateway.events) → topic+action → RabbitMQ
        → @BrokerAction method → (reply for rpc | nothing for event) → back
```

- A **topic** is a logical name with a `mode`: `rpc` | `handle` | `broadcast` | `event`.
- A topic maps to an AMQP path through a **queue** (which belongs to an **exchange**)
  or directly via `exchange` + `routingKey`.
- `@BrokerAction(topic, action)` methods are auto-discovered at boot; one consumer per
  topic dispatches by `action`.
- The same method serves both **RPC** (`requestData`, waits for the reply) and **event**
  (`publishMessage`, waits only for the broker's publisher confirm).
- A microservice can announce its `@BrokerHTTP` routes to a gateway over AMQP
  (**route auto-discovery**) so the gateway registers them without YAML edits.

***REMOVED******REMOVED*** When to use this skill

Load the bundled reference files before editing config, handlers or the gateway:

- **`references/config-schema.md`** — full YAML schema for every section, field by field
  (broker incl. `routeDiscovery`, topics 4 modes, auth-providers name-keyed, gateway
  paths + ws + events).
- **`references/gotchas.md`** — the checklist of bug-prone cases. ALWAYS scan it before
  adding/changing a topic, queue, exchange, action, route, auth provider or WS event.

The authoritative human-facing docs live under the repo `docs/` directory; these two files
are the terse, rules-first version for editing tasks:

- `docs/README.md` — index. `docs/getting-started.md` — bootstrap a ms + gateway.
- `docs/broker.md` — `@BrokerAction`/`@BrokerParam`, topic modes, RPC, `BrokerService`.
- `docs/gateway.md` — `gateway.paths[]`, `gateway.events[]`, auth gate, status mapping, ws.
- `docs/acl.md` — name-keyed actions/roles, dual grant/revoke, `acl-can-user-do*` checks.
- `docs/gateway-admin.md` — DB routes, name-keyed auth-providers, metrics, health, route-sync.
- `docs/gotchas.md` — the canonical source `references/gotchas.md` is ported from.

Runnable examples live under `sample/config-sample/` (`gateway-in-memory`, `gateway-db`,
`calculator.ms`, plus the annotated `broker/gateway/acl/gateway-admin.yaml` reference
configs). The retired `apps/gateway-2` is gone — do not cite it.

***REMOVED******REMOVED*** Sibling task skills

- `rlb-amqp-add-action` — add/modify a `@BrokerAction` handler and sync `config.yaml`.
- `rlb-amqp-add-route` — expose an action over HTTP (`gateway.paths[]`).
- `rlb-amqp-add-ws-event` — add a secure WebSocket/webhook event (`gateway.events[]`).
- `rlb-amqp-scaffold` — bootstrap a new microservice/gateway (module, main, config).
- `rlb-amqp-acl` — name-keyed actions/roles, grant/revoke, the `acl-can-user-do*` checks.
- `rlb-amqp-gateway-admin` — DB routes/auth-providers, metrics, health, route auto-discovery.

***REMOVED******REMOVED*** Golden rules (summary — full list in references/gotchas.md)

1. The topic `name` must be identical in: `@BrokerAction`, `topics[].name`,
   `requestData`/`publishMessage`, `gateway.paths[].topic` / `events[]`.
2. `mode: rpc`/`handle` need `topics[].queue` present in `broker.queues[]`, whose
   `exchange` exists in `broker.exchanges[]`.
3. Exchange `type: topic` → the queue MUST have a `routingKey`.
4. `broadcast` and the WebSocket gateway require a **distinct** `connection_name` per
   instance (set it, or let `broker.routeDiscovery.serviceName` fill it in).
5. `(topic, action)` must be unique — duplicates overwrite silently.
6. No destructuring / default values in `@BrokerAction` method parameters; always pass an
   explicit `name` to `@BrokerParam`.
7. `publishMessage` is `async` — `await` it for the publisher-confirm guarantee.
8. `roles` (HTTP or WS) require an `IAclRoleService` registered via
   `RLB_GTW_ACL_ROLE_SERVICE` in `ProxyModule.forRootAsync({ providers: [...] })`.
   Auth-providers + gateway config are passed to `ProxyModule` (not `BrokerModule`).
9. Topic names `rlb-acl` / `rlb-gateway-admin` / `rlb-gateway-control` and ALL action
   strings (`acl-*`, `gw-path-*`, `gw-auth-*`, `gw-metrics-*`, `gw-health`, `gw-reload`)
   are decorator-bound and NOT configurable. Only exchange/queue/routingKey and the
   route-discovery exchange/queue are.
10. ACL actions/roles and gateway-admin auth-providers are **name-keyed**: `PUT` upserts,
    `GET` lists, `GET .../get?name=`, `DELETE` by name. There is no POST and no id-based
    ACL CRUD. Boolean checks (`/acl/check*`) return `200` with `true`/`false`.
11. HTTP-route auth is **per ROUTE** and DECOUPLED from `@BrokerHTTP`: pair `@BrokerHTTP { name }`
    ↔ `@BrokerAuth` `httpName`. A single `@BrokerHTTP` auto-pairs its `@BrokerAuth` (no name needed);
    a route with no `@BrokerAuth` is public.
