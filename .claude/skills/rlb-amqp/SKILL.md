---
name: rlb-amqp
description: Reference, schema and gotchas for the @open-rlb/nestjs-amqp library (NestJS + RabbitMQ/AMQP + HTTP/WebSocket gateway). Use when answering questions about its YAML config (broker, topics, auth-providers, gateway, ws), AMQP rpc/handle/broadcast/event semantics, the @BrokerAction/@BrokerParam decorators, the BrokerService API, or when debugging wiring/timeout/auth/websocket errors. Also use as the shared knowledge base for the rlb-amqp-add-action, rlb-amqp-add-route, rlb-amqp-add-ws-event and rlb-amqp-scaffold skills.
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

***REMOVED******REMOVED*** When to use this skill

Load the bundled reference files before editing config, handlers or the gateway:

- **`references/config-schema.md`** — full YAML schema for every section, field by field.
- **`references/gotchas.md`** — the checklist of bug-prone cases. ALWAYS scan it before
  adding/changing a topic, queue, exchange, action, route, auth provider or WS event.

The human-facing docs live in the repo `README.md`; these files are the terse,
rules-first version for editing tasks.

***REMOVED******REMOVED*** Sibling task skills

- `rlb-amqp-add-action` — add/modify a `@BrokerAction` handler and sync `config.yaml`.
- `rlb-amqp-add-route` — expose an action over HTTP (`gateway.paths[]`).
- `rlb-amqp-add-ws-event` — add a secure WebSocket/webhook event (`gateway.events[]`).
- `rlb-amqp-scaffold` — bootstrap a new microservice/gateway (module, main, config).

***REMOVED******REMOVED*** Golden rules (summary — full list in references/gotchas.md)

1. The topic `name` must be identical in: `@BrokerAction`, `topics[].name`,
   `requestData`/`publishMessage`, `gateway.paths[].topic` / `events[]`.
2. `mode: rpc`/`handle` need `topics[].queue` present in `broker.queues[]`, whose
   `exchange` exists in `broker.exchanges[]`.
3. Exchange `type: topic` → the queue MUST have a `routingKey`.
4. `broadcast` and the WebSocket gateway require `connection_name`.
5. `(topic, action)` must be unique — duplicates overwrite silently.
6. No destructuring / default values in `@BrokerAction` method parameters; always pass an
   explicit `name` to `@BrokerParam`.
7. `publishMessage` is `async` — `await` it for the publisher-confirm guarantee.
8. `roles` (HTTP or WS) require an `IAclRoleService` registered via
   `RLB_GTW_ACL_ROLE_SERVICE` in `ProxyModule.forRootAsync({ providers: [...] })`.
   Auth-providers + gateway config are passed to `ProxyModule` (not `BrokerModule`).
