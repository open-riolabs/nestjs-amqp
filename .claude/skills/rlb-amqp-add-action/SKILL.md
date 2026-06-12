---
name: rlb-amqp-add-action
description: Add or modify a @BrokerAction handler in a @open-rlb/nestjs-amqp microservice AND keep config.yaml in sync. Use whenever the user adds/changes a broker action, RPC method, or event handler, or says the YAML must be updated to match a new @BrokerAction method (topic/queue/exchange, and optionally a gateway route). Generates the decorated method and the exact YAML fragments to add.
---

***REMOVED*** Add a @BrokerAction handler and sync config.yaml

Goal: when a broker handler is added or changed, produce BOTH the decorated method and the
matching `config.yaml` fragments, with no missing wiring.

First, read the shared reference (schema + gotchas):
- `.claude/skills/rlb-amqp/references/config-schema.md`
- `.claude/skills/rlb-amqp/references/gotchas.md`

Then locate the project's `config.yaml` (commonly `config/config.yaml`) and the service file.

***REMOVED******REMOVED*** Inputs to determine (ask only if not inferable)

- **topic** (logical name), **action** (string), **mode** intended: `rpc` (default) or `event`.
- Payload fields the method needs, and any forwarded headers (e.g. `X-GTW-AUTH-USERID`).
- Whether to also expose it over HTTP (if yes, see the `rlb-amqp-add-route` skill) or WS.

***REMOVED******REMOVED*** Step 1 — the handler method

Add an `@Injectable()` service method. Keep parameters FLAT (no destructuring, no default
values — see gotchas 1–2). Always pass an explicit `name` to `@BrokerParam`.

```ts
import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class <Domain>ActionService {
  @BrokerAction('<topic>', '<action>', 'rpc')
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

***REMOVED******REMOVED*** Step 2 — YAML sync (the critical part)

Reconcile `config.yaml` so the topic resolves. Add ONLY what's missing (idempotent):

1. **Topic** in `topics[]`:
   ```yaml
   - name: <topic>
     mode: rpc            ***REMOVED*** or handle/event
     queue: <topic>-q     ***REMOVED*** rpc/handle: must reference a queue below
   ```
2. **Queue** in `broker.queues[]` (for rpc/handle):
   ```yaml
   - name: <topic>-q
     exchange: <exchange>
     routingKey: <topic>          ***REMOVED*** REQUIRED if the exchange is type: topic
     createQueueIfNotExists: true
     options: { durable: true }
   ```
3. **Exchange** in `broker.exchanges[]` (if not present):
   ```yaml
   - name: <exchange>
     type: direct                 ***REMOVED*** or topic — then queue.routingKey is mandatory
     createExchangeIfNotExists: true
     options: { durable: true }
   ```
4. For an **event-publishable** topic (no reply) you can instead use
   `exchange` + `routingKey` directly on the topic.

If the action is just another action on an EXISTING topic, do NOT add a new
queue/exchange — only ensure the `(topic, action)` pair is unique (gotcha 3). The topic's
single consumer dispatches by `action`.

***REMOVED******REMOVED*** Step 3 — verify against gotchas

- topic `name` identical in code and YAML (gotcha 5)
- queue exists and its exchange exists (gotcha 6)
- topic-type exchange ⇒ queue has `routingKey` (gotcha 7)
- `(topic, action)` unique (gotcha 3)
- header params read the prefixed/uppercased name (gotcha 4)

***REMOVED******REMOVED*** Step 4 — build

Run `npm run build`. Optionally show the user the RPC vs event call sites:

```ts
await broker.requestData('<topic>', '<action>', payload, headers);     // waits reply
await broker.publishMessage('<topic>', '<action>', payload, headers);  // awaits confirm
```

***REMOVED******REMOVED*** Output

Present: (a) the handler diff, (b) the exact YAML fragments to insert (with their parent
path), (c) a one-line note of any gotcha you had to satisfy. If multiple files/fragments,
list them so the user can review before applying.
