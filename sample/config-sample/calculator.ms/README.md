***REMOVED*** calculator.ms — pure AMQP microservice sample

A minimal `@open-rlb/nestjs-amqp` microservice that does exactly two things:

1. Exposes five calculator operations as **AMQP RPC handlers** (`@BrokerAction`), reachable over RabbitMQ — never over HTTP.
2. **Announces** the matching `@BrokerHTTP` route metadata through **route auto-discovery**, so a gateway can pick those routes up and publish them as real HTTP endpoints.

It is the smallest end-to-end illustration of the **publisher** side of route discovery, paired with the simplest possible `BrokerModule` wiring.

---

***REMOVED******REMOVED*** Purpose

This service is an **AMQP-only** microservice. There is **no HTTP server**: `src/main.ts` calls `app.init()`, not `app.listen()`.

```ts
// src/main.ts
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
await app.init();   // NOT app.listen() — no HTTP port is opened
```

Once the app is initialized, the `@BrokerAction` handlers in `AppService` start consuming from RabbitMQ. The service is reachable **over the broker**, not over a socket. The `app.port` / `app.host` in `config/config.yaml` are unused here — they are kept only to satisfy `AppConfig`.

`enableShutdownHooks()` lets `BrokerModule` drain in-flight RPC work and close the AMQP connection cleanly on `SIGINT` / `SIGTERM`.

Each handler carries **two** decorators at once:

- `@BrokerAction("calculator", "<op>")` — the AMQP RPC binding. The method becomes a handler on the `calculator` topic, dispatched by the `<op>` action name.
- `@BrokerHTTP("POST", "/calculator/<op>", "body")` — the route metadata. This is *not* served by this process; it is what a gateway **discovers** and publishes as an HTTP endpoint that forwards back to the same handler.

So one method definition serves both the AMQP contract and the future HTTP contract.

---

***REMOVED******REMOVED*** Use cases

- **The publisher side of route discovery.** This service announces its own routes; a gateway (the consumer) persists and serves them. See [How route discovery works here](***REMOVED***how-route-discovery-works-here).
- **The simplest possible `BrokerModule` wiring.** No gateway, no ACL, no auth, no database — just `ConfigModule` + `BrokerModule.forRootAsync` + one provider.
- **How `serviceName` promotes to `connection_name`.** The service sets its identity exactly once, under `broker.routeDiscovery.serviceName`, and the broker reuses it as the AMQP `connection_name`.

***REMOVED******REMOVED******REMOVED*** Module wiring

```ts
// src/app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        options:    configService.get<RabbitMQConfig>('broker')!,
        topics:     configService.get<BrokerTopic[]>('topics')!,
        appOptions: configService.get<AppConfig>('app'),
      }),
    }),
  ],
  providers: [AppService],
})
export class AppModule {}
```

The factory forwards just three blocks: `broker`, `topics`, `app`. Route auto-discovery is **not** a separate module argument — it lives **inside the broker block** as `broker.routeDiscovery`, and `BrokerModule` reads `options.routeDiscovery` itself.

***REMOVED******REMOVED******REMOVED*** `serviceName → connection_name`

In `config/config.yaml` no explicit AMQP `connection_name` is set (there is no `connectionManagerOptions.connectionOptions.clientProperties.connection_name`). Because `broker.routeDiscovery.serviceName` **is** set, `BrokerModule` promotes it to the AMQP `connection_name`. An explicit `connection_name` would always win — but here there is none, so the service is identified on the broker as `calculator.ms`, the same string used as its route-ownership key.

---

***REMOVED******REMOVED*** The five operations

All handlers live in `src/app.service.ts`. Parameters are bound **flat** — one `@BrokerParam` per argument, no object destructuring.

| Action | AMQP                              | HTTP route (discovered) | Request field            | Returns                                  |
|--------|-----------------------------------|-------------------------|--------------------------|------------------------------------------|
| `sum`  | `@BrokerAction("calculator","sum")` | `POST /calculator/sum`  | `body.values: number[]`  | sum of all values (seed `0` → `[]` is `0`) |
| `sub`  | `@BrokerAction("calculator","sub")` | `POST /calculator/sub`  | `body.values: number[]`  | left-to-right subtraction (first element is the seed) |
| `mul`  | `@BrokerAction("calculator","mul")` | `POST /calculator/mul`  | `body.values: number[]`  | product of all values (seed `1` → `[]` is `1`) |
| `div`  | `@BrokerAction("calculator","div")` | `POST /calculator/div`  | `body.values: number[]`  | left-to-right division (first element is the numerator) |
| `sqrt` | `@BrokerAction("calculator","sqrt")`| `POST /calculator/sqrt` | `body.value: number`     | `Math.sqrt(value)`                       |

***REMOVED******REMOVED******REMOVED*** Request shape

- `sum` / `sub` / `mul` / `div` take an **array** under `values`. The handler binds it with `@BrokerParam("body", "values")`.

  ```json
  { "values": [10, 4, 1] }
  ```

- `sqrt` takes a **single number** under `value`, bound with `@BrokerParam("body", "value")`.

  ```json
  { "value": 16 }
  ```

The topic name `calculator` and the action strings (`sum`, `sub`, `mul`, `div`, `sqrt`) come from this service's own `@BrokerAction` decorators and its `topics:` block — they are this sample's own naming, configurable here. (By contrast, the framework's built-in topic names like `rlb-gateway-admin` and its action strings such as `gw-path-export` / `gw-reload` are decorator-bound in the library and **not** configurable.)

---

***REMOVED******REMOVED*** How route discovery works here

This service is the **publisher**. The route-discovery config sits inside the broker block:

```yaml
***REMOVED*** config/config.yaml
broker:
  routeDiscovery:
    serviceName: calculator.ms   ***REMOVED*** ownership key + promoted to AMQP connection_name
    publishOnBoot: true          ***REMOVED*** announce every @BrokerHTTP route at boot
```

On bootstrap (since `serviceName` is set and `publishOnBoot` is not `false`), the publisher maps this app's `@BrokerHTTP` / `@BrokerAction` metadata into a route manifest and publishes it to the route-discovery **fanout exchange** as a durable, persistent message. The durable queue buffers it even if no gateway is up yet — it is delivered once one connects.

`broker.routeDiscovery` also accepts `exchange` and `queue` (defaults `rlb-route-discovery` / `rlb-route-sync`). They are omitted here, so the defaults apply. These **are** configurable, but the values must match on both the publisher and the consuming gateway.

***REMOVED******REMOVED******REMOVED*** Pair it with a gateway to see the routes appear

Run this service alongside one of the gateway samples (the **consumer** of route manifests):

- **gateway-in-memory** — stores discovered routes in memory.
- **gateway-db** — persists discovered routes in a database.

With both running against the same RabbitMQ instance (and matching route-discovery exchange/queue), the gateway consumes this manifest, persists the routes, and registers them — so `/calculator/sum`, `/calculator/sub`, `/calculator/mul`, `/calculator/div` and `/calculator/sqrt` appear as live HTTP endpoints **on the gateway**. A request to the gateway's `POST /calculator/sum` is forwarded over AMQP to this microservice's `calculator` / `sum` handler and the result is returned over HTTP.

> The gateway must also declare this microservice's broker **topic** (`calculator`) in its own broker config so it can route forwarded calls back here.

---

***REMOVED******REMOVED*** How to run

This service needs **only RabbitMQ**. No database, no gateway (the gateway is optional, for observing route discovery).

1. Point the broker at your RabbitMQ instance. Edit `config/config.yaml`:

   ```yaml
   broker:
     uri: "amqp://localhost:5672/"   ***REMOVED*** vhost after the last slash; replace for a remote broker
   ```

   The sample uses `guest`/`guest`, which only authenticates from `localhost`. For any remote broker (e.g. `amqp://localhost:5672/` → your host), replace the credentials under `connectionManagerOptions.connectionOptions.credentials`.

2. Start the microservice, either:

   - **VS Code** → Run and Debug → **"Debug calculator.ms (microservice)"**, or
   - **CLI**:

     ```bash
     npx nest start calculator.ms
     ```

3. (Optional) Start `gateway-in-memory` or `gateway-db` to watch `/calculator/*` get published via route discovery.

---

***REMOVED******REMOVED*** Dependency note

This sample's `package.json` pins `@open-rlb/nestjs-amqp` at `^2.0.5`. When run **in-tree** (inside this repo), it resolves to the **local workspace** copy of the library rather than the published package — so changes to the library are picked up directly without a publish/reinstall cycle.
