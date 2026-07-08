---
name: rlb-amqp-add-action
description: Add or modify a @BrokerAction handler in a @open-rlb/nestjs-amqp microservice AND keep config.yaml in sync. Use whenever the user adds/changes a broker action, RPC method, or event handler, or says the YAML must be updated to match a new @BrokerAction method (topic/queue/exchange, and optionally a gateway route). Generates the decorated method and the exact YAML fragments to add.
---

# Add a @BrokerAction handler and sync config.yaml

Goal: when a broker handler is added or changed, produce BOTH the decorated method and the
matching `config.yaml` fragments, with no missing wiring.

First, read the shared reference (schema + gotchas):
- `.claude/skills/rlb-amqp/references/config-schema.md`
- `.claude/skills/rlb-amqp/references/gotchas.md`

Authoritative source of truth: `docs/broker.md` (decorators + modes) and the runnable
`sample/config-sample/calculator.ms` (its `src/app.service.ts` + `config/config.yaml`).

Then locate the project's `config.yaml` (commonly `config/config.yaml`) and the service file.

## Inputs to determine (ask only if not inferable)

- **topic** (logical name), **action** (string), **mode** intended: `rpc` (default) or `event`.
- Payload fields the method needs, and any forwarded headers (e.g. `X-GTW-AUTH-USERID`).
- Whether to also expose it over HTTP — inline via `@BrokerHTTP` (auto-publish to a gateway,
  see Step 1b) or via a `gateway.paths[]` entry (`rlb-amqp-add-route` skill), or over WS.

## Step 1 — the handler method

Add an `@Injectable()` service method. Keep parameters FLAT (no destructuring, no default
values — see gotchas 1–2). Always pass an explicit `name` to `@BrokerParam`.

```ts
import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class <Domain>ActionService {
  @BrokerAction('<topic>', '<action>', 'rpc')   // type? = 'rpc' (default) | 'event'
  async <method>(
    @BrokerParam('body', '<field>') field: string,
    @BrokerParam('header', 'X-GTW-AUTH-USERID') userId: string,
  ) {
    // rpc → return a value; event callers ignore it.
    return { ok: true };
  }
}
```

Ensure the service is a provider in a module that NestJS loads (the
`MetadataScannerService` auto-discovers it at boot). Throwing an error whose `name` maps to
an HTTP status (e.g. `NotFoundError`) yields the right gateway status.

### `@BrokerAction(topic, action, type?)`

- `topic` must match a `topics:` entry (an `rpc` topic). `action` is the dispatch key.
- **`(topic, action)` must be unique** across the whole app — all actions of a topic share
  ONE consumer/queue, dispatched by `action` (gotcha 3).
- A single method may carry **multiple** `@BrokerAction`s. When it does, any `@BrokerHTTP` on
  that method **must name its `action`** to pair deterministically (decorator order is never
  used). Auth pairs separately — see `@BrokerAuth` below.

### `@BrokerParam(source, name?, pipe?)` — one source per argument

No object destructuring; declare a separate param per field. A param with no `@BrokerParam`
defaults to `source: 'body'` keyed by its own name. Optional `pipe` is a `PipeTransform`.

| `source` | Resolves to |
|---|---|
| `body` | `payload[name ?? paramName]` — a single body field. |
| `body-full` | the entire `payload` object. |
| `header` | `headers[name ?? paramName]` — one AMQP/forwarded header (UPPERCASE+prefixed, gotcha 4). |
| `tag` | the consumer tag of the delivery. |
| `action` | the dispatched action string. |
| `topic` | the topic name. |

## Step 1b (optional) — `@BrokerHTTP` for route auto-publish

To expose the same handler over HTTP **without** hand-editing the gateway, stack
`@BrokerHTTP("METHOD", "/path", dataSource, options?)` on top of the `@BrokerAction`. On boot
the microservice publishes its `@BrokerHTTP` routes as a manifest to the gateway (route
auto-discovery), which persists + registers them. This requires `broker.routeDiscovery`
(see `rlb-amqp` reference / `docs/gateway-admin.md`); the gateway must also declare this
service's topic so it can forward calls.

`dataSource` is `'query' | 'body' | 'params'`. The options object carries
`{ name?, action?, successStatusCode?, timeout?, parseRaw?, binary?, redirect?, headers?,
forwardHeaders? }` — it does **not** carry auth.

Two independent pairings sit on the method, each only needed in the multi case:

- **http ↔ action** (`@BrokerHTTP`'s `action`): bind a route to one of several `@BrokerAction`s.
  Required only when the method declares **more than one** `@BrokerAction`; with a single action
  it defaults to that action.
- **auth ↔ route** (`@BrokerAuth`'s `httpName` ⇄ `@BrokerHTTP`'s `name`): bind an auth rule to one
  of several routes. Required only when the method declares **more than one** `@BrokerHTTP`; with a
  single route the auth auto-pairs (no `name`/`httpName` needed). A route with no paired
  `@BrokerAuth` is **public**.

Auth lives in a separate, decoupled decorator —
`@BrokerAuth(authName, allowAnonymous?, actions?, httpName?)` — never inside `@BrokerHTTP`'s options.
The 3rd param is `actions` (ACL action names, was `roles`). This lets two HTTP paths for the SAME
action carry DIFFERENT auth.

Simple case — one route, auth auto-pairs (no names needed):

```ts
@BrokerAction('calculator', 'sum')
@BrokerHTTP('POST', '/calculator/sum', 'body')   // dataSource: 'query' | 'body' | 'params'
@BrokerAuth('cust-jwks', true)                   // auto-pairs to the single route; public if omitted
async sum(@BrokerParam('body', 'values') values: number[]) {
  return values.reduce((a, v) => a + v, 0);
}
```

Multi case — two routes for ONE action, each name-paired to its own auth:

```ts
@BrokerAction('booking', 'get-booking')
@BrokerHTTP('GET', '/bookings/:id',       'params', { name: 'get-booking' })
@BrokerAuth('cust-jwks', true, undefined, 'get-booking')          // httpName ⇄ route name
@BrokerHTTP('GET', '/admin/bookings/:id', 'params', { name: 'admin-get-booking' })
@BrokerAuth('admin-jwks', undefined, ['booking.admin'], 'admin-get-booking')  // 3rd param = ACL actions
async getBooking(@BrokerParam('params', 'id') id: string) {
  return this.bookings.find(id);
}
```

An `@BrokerAuth` whose `httpName` matches no route is NOT applied and logs a WARNING at
microservice startup.

(Single-route pattern taken verbatim from `sample/config-sample/calculator.ms/src/app.service.ts`.)

## Step 2 — YAML sync (the critical part)

Reconcile `config.yaml` so the topic resolves. Add ONLY what's missing (idempotent):

1. **Topic** in `topics[]`:
   ```yaml
   - name: <topic>
     mode: rpc            # or handle/event
     queue: <topic>-q     # rpc/handle: must reference a queue below
   ```
2. **Queue** in `broker.queues[]` (for rpc/handle):
   ```yaml
   - name: <topic>-q
     exchange: <exchange>
     routingKey: <topic>          # REQUIRED if the exchange is type: topic
     createQueueIfNotExists: true
     options: { durable: true }
   ```
3. **Exchange** in `broker.exchanges[]` (if not present):
   ```yaml
   - name: <exchange>
     type: direct                 # or topic — then queue.routingKey is mandatory
     createExchangeIfNotExists: true
     options: { durable: true }
   ```
4. For an **event-publishable** topic (no reply) you can instead use
   `exchange` + `routingKey` directly on the topic.

If the action is just another action on an EXISTING topic, do NOT add a new
queue/exchange — only ensure the `(topic, action)` pair is unique (gotcha 3). The topic's
single consumer dispatches by `action`.

## Step 3 — verify against gotchas

- topic `name` identical in code and YAML (gotcha 5)
- queue exists and its exchange exists (gotcha 6)
- topic-type exchange ⇒ queue has `routingKey` (gotcha 7)
- `(topic, action)` unique (gotcha 3)
- header params read the prefixed/uppercased name (gotcha 4)
- if multiple `@BrokerAction` on one method ⇒ each `@BrokerHTTP` names its `action`
- if multiple `@BrokerHTTP` on one method ⇒ each `@BrokerAuth` sets `httpName` = the route's `name`

## Step 4 — build

Run `npm run build`. Optionally show the user the RPC vs event call sites:

```ts
await broker.requestData('<topic>', '<action>', payload, headers);     // waits reply
await broker.publishMessage('<topic>', '<action>', payload, headers);  // awaits confirm
```

## Output

Present: (a) the handler diff, (b) the exact YAML fragments to insert (with their parent
path), (c) a one-line note of any gotcha you had to satisfy. If multiple files/fragments,
list them so the user can review before applying.
