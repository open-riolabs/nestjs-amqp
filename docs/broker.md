***REMOVED*** Broker

The **broker** is the core of `@open-rlb/nestjs-amqp`. It wraps a managed RabbitMQ connection and turns plain NestJS providers into AMQP message handlers via decorators, while giving you a small imperative API (`BrokerService`) for publishing, RPC, and fire-and-forget messaging.

A broker can act as a **microservice** (it consumes a topic and answers requests) and/or as a **publisher/requester** (it talks to other services). The [gateway](./gateway.md) is just a specialised broker that also exposes HTTP/WebSocket.

---

***REMOVED******REMOVED*** Base features

- **Decorator-driven handlers** — annotate any provider method with `@BrokerAction(topic, action)`; the library scans your modules at boot and subscribes an RPC consumer per topic that dispatches by `action`.
- **Flat parameter binding** — `@BrokerParam(source, name?, pipe?)` maps a single message field to a single method argument. No destructuring.
- **Four topic modes** — `rpc`, `event`, `broadcast`, `handle`, declared in YAML and matched to the broker's exchanges/queues.
- **Imperative API** — `BrokerService.requestData()` (RPC), `publishMessage()` (fire-and-forget with publisher confirm), plus `registerRpc()` / `registerHandler()` for non-decorator wiring.
- **Publisher confirms** — publishes resolve only once the broker has accepted the message (rejects on nack).
- **Route auto-discovery** — a microservice can announce its `@BrokerHTTP` routes to a gateway over AMQP (see [gateway-admin](./gateway-admin.md)).
- **Graceful shutdown** — `ShutdownStateService` + `DrainableStream` drain in-flight work before the process exits.

---

***REMOVED******REMOVED*** Nest config (app config)

Register the module once in your root `AppModule` with `BrokerModule.forRoot(options, topics, appOptions?)`:

```ts
import { Module } from '@nestjs/common';
import { BrokerModule } from '@open-rlb/nestjs-amqp';
import config from './config'; // loads config.yaml

@Module({
  imports: [
    BrokerModule.forRoot(
      config.broker,   // RabbitMQConfig — the `broker:` YAML block
      config.topics,   // BrokerTopic[]  — the `topics:` YAML block
      config.app,      // AppConfig (optional) — e.g. { environment, port, host }
    ),
  ],
  providers: [/* your @BrokerAction services */],
})
export class AppModule {}
```

The three arguments map directly to the three top-level YAML blocks (`broker:`, `topics:`, `app:`). `options` and `topics` are **required** — `forRoot` throws if either is missing.

***REMOVED******REMOVED******REMOVED*** Async configuration

When the config has to be resolved asynchronously (e.g. fetched, or assembled from `ConfigService`), use `forRootAsync`. The factory returns one object with `{ options, topics, appOptions? }`:

```ts
BrokerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    options: cfg.get('broker'),
    topics: cfg.get('topics'),
    appOptions: cfg.get('app'),
  }),
});
```

***REMOVED******REMOVED******REMOVED*** Route discovery & `serviceName → connection_name`

Route auto-discovery for the **publisher** (a microservice announcing its HTTP routes) now lives **inside the broker config** as `options.routeDiscovery` — not as a separate module argument. It carries `{ serviceName, publishOnBoot?, exchange?, queue? }`.

`serviceName` does double duty: if you set it and you have **not** set an explicit AMQP `connection_name` under `connectionManagerOptions.connectionOptions.clientProperties`, the broker uses `serviceName` as the `connection_name`. So a publishing microservice configures its identity once. An explicit `connection_name` always wins.

> The gateway (the **consumer** of route manifests) does not use `broker.routeDiscovery`; it configures its side via `GatewayAdminModule`. See [gateway-admin](./gateway-admin.md).

---

***REMOVED******REMOVED*** YAML config

***REMOVED******REMOVED******REMOVED*** The `broker:` block (`RabbitMQConfig`)

This is passed verbatim as the first argument to `forRoot`. Key fields:

| Field | Purpose |
|---|---|
| `uri` | AMQP connection URI (incl. vhost). |
| `prefetchCount` | Default prefetch for all channels. |
| `exchanges` | Exchanges to assert (`name`, `type`, `options`, …). |
| `queues` | Queues to assert and bind (`name`, `exchange`, `routingKey`, …). |
| `defaultRpcTimeout` | Default RPC timeout in ms (falls back to `10000`). |
| `replyQueues` | `{ [exchange]: queueName }` — fixed reply queues per exchange for RPC (see [RPC](***REMOVED***rpc)). |
| `connectionManagerOptions` | Passed to `amqp-connection-manager`; holds `connection_name`, credentials, heartbeats. |
| `connectionInitOptions` | `{ wait?, timeout?, reject?, … }` — whether to block on a healthy connection at boot (default `wait: true`, `timeout: 5000`, `reject: true`). |
| `defaultAlternateExchange` | String or object. Asserts an alternate exchange and attaches it to declared exchanges so unroutable messages are diverted instead of dropped. |
| `onUnroutableMessage` | Callback fired when the broker returns an unroutable message (requires `mandatory: true` on publish). |
| `routeDiscovery` | Publisher-side route auto-discovery — `{ serviceName, publishOnBoot?, exchange?, queue? }` (see above). |

```yaml
broker:
  uri: "amqp://broker.example.net:5672/my-vhost"
  routeDiscovery:
    serviceName: demo-ms       ***REMOVED*** also becomes connection_name unless set below
    publishOnBoot: true
  connectionManagerOptions:
    heartbeatIntervalInSeconds: 60
    connectionOptions:
      clientProperties:
        connection_name: "my-service-1"   ***REMOVED*** explicit name wins over serviceName
  exchanges:
    - name: rlb
      type: direct
      options: { durable: true }
  queues:
    - name: my-queue
      exchange: rlb
      routingKey: my-queue
      options: { durable: true }
```

***REMOVED******REMOVED******REMOVED*** The `topics:` block (`BrokerTopic[]`)

Each topic names a logical channel and binds it to a `mode`. The mode decides how the broker wires it and what `BrokerService`/decorators do with it.

| Field | Notes |
|---|---|
| `name` | Logical topic name. Referenced by `@BrokerAction(topic, …)`, `requestData(topic, …)`, etc. |
| `mode` | `rpc` \| `event` \| `broadcast` \| `handle`. |
| `queue` | Queue name (rpc / handle). |
| `exchange` | Exchange name. |
| `routingKey` | Routing key (broadcast / topic exchanges). |
| `errorBehavior` | Connection-level behaviour on handler failure for the decorator path. Default `REQUEUE`. |
| `mandatory` | Publish with the AMQP `mandatory` flag (unroutable → returned). Default `false`. |
| `persistent` | Publish with delivery-mode 2 (survives a broker restart if the queue is durable). Default `false`. |
| `toObservable` | For `handle`: emit incoming messages onto `BrokerService.events$` instead of invoking a handler function. |

**The four modes:**

- **`rpc`** — request/response. The microservice side registers an RPC consumer on `queue`; callers use `requestData()` and wait for a reply. Requires `queue` or `exchange`. This is also the mode used by decorator-discovered `@BrokerAction` handlers.
- **`event`** — fire-and-forget publish. No consumer is asserted for the topic itself; you publish to its exchange/routing key with `publishMessage()` and the message is delivered to whatever is bound.
- **`broadcast`** — fan-out. The consumer asserts a **per-instance** queue named `` `${topic}-${connection_name}` `` bound to `exchange`/`routingKey`, so every running instance gets its own copy. **Requires a distinct `connection_name` per instance** (the broker throws on boot if `connection_name` is missing).
- **`handle`** — plain consumer (no reply). Looks up `queue` (and its exchange/routingKey) in the broker config and subscribes via `registerHandler()` or, with `toObservable: true`, streams onto `events$`.

```yaml
topics:
  - name: rlb-acl
    mode: rpc
    queue: rlb-acl
    exchange: rlb
    routingKey: rlb-acl
  - name: rlb-gateway-control
    mode: broadcast
    exchange: rlb
    routingKey: rlb-gateway-control
```

---

***REMOVED******REMOVED*** Microservice implementation

Decorate any provider method. The metadata scanner discovers it at boot and subscribes an RPC consumer per topic that dispatches incoming messages by `action`.

***REMOVED******REMOVED******REMOVED*** `@BrokerAction(topic, action, type?)`

- `topic` — must match a `topics:` entry (an `rpc` topic).
- `action` — the dispatch key. **`(topic, action)` must be unique** across your whole app — two handlers claiming the same pair collide.
- `type` — `'rpc'` (default semantics, replies) or `'event'`.

A single method may declare **multiple** `@BrokerAction`s (one method servicing several actions). When it does, any `@BrokerHTTP` on that method **must name its `action`** (the `action` option) to bind to the right `@BrokerAction` deterministically — decorator order is never used. This http↔action pairing is independent of auth; auth is paired separately by route name (see [`@BrokerAuth`](***REMOVED***brokerauthauthname-allowanonymous-actions-httpname)).

***REMOVED******REMOVED******REMOVED*** `@BrokerHTTP(method, path, dataSource, options?)`

Exposes the method as an HTTP route, published to a gateway via [route auto-discovery](./gateway-admin.md). `dataSource` is `'query' | 'body' | 'params'`. Notable options: `name` (optional route name used for auth pairing), `action` (disambiguates when the method declares **multiple** `@BrokerAction`), plus `successStatusCode`, `timeout`, `parseRaw`, `binary`, `redirect`, `headers`, `forwardHeaders`. `@BrokerHTTP` does **not** carry auth — auth lives in a decoupled `@BrokerAuth`.

***REMOVED******REMOVED******REMOVED*** `@BrokerAuth(authName, allowAnonymous?, actions?, httpName?)`

Auth for an HTTP route, kept **decoupled** from `@BrokerHTTP`. It pairs to a specific `@BrokerHTTP` route by `httpName` === that route's `name`.

- `authName` — the auth provider to apply.
- `allowAnonymous?` — allow unauthenticated access.
- `actions?` — actions the caller must hold (OR-semantics) on the request's `(companyId, resourceId)`; the gateway gates the route with `acl-check-action`.
- `httpName?` — the `name` of the `@BrokerHTTP` route this auth applies to.

**Pairing rules:**

- A method with **one** `@BrokerHTTP` → the `@BrokerAuth` **auto-pairs** (no `name` / `httpName` needed). The simple case.
- A method with **multiple** `@BrokerHTTP` → each `@BrokerHTTP` needs a `name` and each `@BrokerAuth` must set a matching `httpName`. An `@BrokerAuth` without a matching `httpName` is **not** applied and logs a **warning** at microservice startup.
- A route with no paired `@BrokerAuth` is **public**.

Because auth pairs by route name rather than by action, two HTTP paths for the **same** action can have **different** auth:

```ts
@BrokerAction('booking', 'get-booking')
@BrokerHTTP('GET', '/bookings/:id',       'params', { name: 'get-booking' })
@BrokerAuth('cust-jwks', true, undefined, 'get-booking')
@BrokerHTTP('GET', '/admin/bookings/:id', 'params', { name: 'admin-get-booking' })
@BrokerAuth('admin-jwks', undefined, ['read-booking'], 'admin-get-booking')
getBooking(@BrokerParam('params', 'id') id: string) { /* … */ }
```

***REMOVED******REMOVED******REMOVED*** `@BrokerParam(source, name?, pipe?)`

Each parameter binds to exactly one field of the incoming message. **One source per argument — no object destructuring**; declare a separate parameter for every field you need (the "flat params" rule). An optional `pipe` (a `PipeTransform`) is applied to the resolved value.

| `source` | Resolves to |
|---|---|
| `body` | `payload[name ?? paramName]` — a single field of the message body. |
| `body-full` | the entire `payload` object. |
| `header` | `headers[name ?? paramName]` — a single AMQP/forwarded header. |
| `tag` | the consumer tag of the delivery. |
| `action` | the dispatched action string. |
| `topic` | the topic name. |

A parameter with no `@BrokerParam` defaults to `source: 'body'` keyed by its own name.

```ts
import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class OrdersService {
  // (topic, action) = ('orders', 'order.create') — unique across the app
  @BrokerAction('orders', 'order.create', 'rpc')
  create(
    @BrokerParam('header', 'X-GTW-AUTH-USERID') userId: string, // one header
    @BrokerParam('body', 'sku') sku: string,                    // one body field
    @BrokerParam('body-full') payload: any,                     // whole body
    @BrokerParam('action') action: string,                      // the action string
  ) {
    return { ok: true, userId, sku, action };
  }
}
```

---

***REMOVED******REMOVED*** Event handling

Beyond request/response, three modes cover one-way messaging:

- **`event`** — publish-only. Call `publishMessage(topic, action, payload, headers?)`; it resolves once the broker confirms acceptance (publisher confirm), not when anything consumes it.
- **`handle`** — a durable consumer that runs a handler with no reply. Register it with `BrokerService.registerHandler(topic, fn)`, or set `toObservable: true` on the topic and read `BrokerService.events$` instead.
- **`broadcast`** — fan-out to every instance. The consumer queue is `` `${topic}-${connection_name}` ``, so **each instance needs a distinct `connection_name`**; otherwise instances share one queue and compete instead of each receiving the message. The control topic the gateway uses for runtime route reloads is a `broadcast` topic.

```ts
// fire-and-forget (event topic)
await broker.publishMessage('audit', 'user.created', { id: 42 });

// consume without replying (handle topic)
broker.registerHandler('audit', async (msg) => {
  console.log(msg.topic, msg.action, msg.payload);
});

// stream of events (handle topic with toObservable: true)
broker.events$.subscribe((e) => console.log(e.action, e.payload));
```

> An `rpc`/`handle` topic can also be published to fire-and-forget: the consumer runs the handler and simply skips the reply when no `replyTo` is present. This lets a producer wait only for the broker to take charge of the message.

---

***REMOVED******REMOVED*** RPC

Call another service and await its response with `requestData`:

```ts
const result = await broker.requestData<Req, Res>(
  'rlb-acl',                         // topic (rpc mode)
  'acl-check-action',                // action
  { userId, action, companyId, resourceId }, // payload
  headers,                           // optional
  timeout,                           // optional, ms
);
```

- **Timeout** — `timeout` arg → topic-resolved → `defaultRpcTimeout` → `10000` ms. On expiry the request rejects.
- **Reply queues** — by default RPC uses RabbitMQ **direct-reply-to** (a fast, per-request pseudo-queue). To use a fixed reply queue instead, map it per exchange in `broker.replyQueues` (`{ [exchange]: queueName }`); when an entry exists for the request's exchange, that `replyTo` is used.
- **Correlation** — every request gets a `correlationId` and an `X-Request-ID` header automatically.
- **Error propagation** — handler errors are serialised back to the caller and **re-thrown** on the requesting side (stack details are included off-production, stripped in `production`). So a remote failure surfaces as a normal thrown error at the call site, not a silent timeout.

---

***REMOVED******REMOVED*** Graceful shutdown

`ShutdownStateService` coordinates an orderly drain so in-flight work finishes before the process dies. Enable Nest's shutdown hooks in `main.ts` for it to fire:

```ts
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();   // REQUIRED — otherwise onModuleDestroy never runs
await app.listen(port);
```

On `SIGINT` / `SIGTERM` (handled once each) the service flips `isShuttingDown`, and a 25s hard-timeout is armed (`process.exit(1)` if draining hangs). On module destroy it:

1. calls `BrokerService.unregisterAll()` — cancels every consumer (decorator-discovered and explicit) **and locks outgoing traffic**: any further `publishMessage()` / `requestData()` throws synchronously, so the instance goes fully silent in both directions; and
2. runs all registered **drainers** in parallel.

Register a drainer for any background pipeline you own:

```ts
shutdownState.register('my-pipeline', () => myStream.drain());
```

***REMOVED******REMOVED******REMOVED*** `DrainableStream`

A helper for RxJS pipelines belonging to one service. Add `takeUntilShutdown()` as the last operator before `.subscribe()`; on `drain()` it signals all tracked streams and resolves once they complete (so buffered items in `concatMap`/`mergeMap` finish first):

```ts
import { DrainableStream } from '@open-rlb/nestjs-amqp';

const stream = new DrainableStream();
source$.pipe(/* … */, stream.takeUntilShutdown()).subscribe(handle);

shutdownState.register('source', () => stream.drain());
```

---

[← Back to index](./README.md)
