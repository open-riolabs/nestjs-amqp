# Getting Started

`@open-rlb/nestjs-amqp` is a NestJS toolkit for building RabbitMQ microservices and an HTTP/WebSocket
gateway in front of them. This page gets you from an empty (or existing) NestJS project to a running
service: install the package, optionally let the `nest add` schematic wire everything for you, or do the
wiring by hand.

See also: [Broker](./broker.md) · [Gateway](./gateway.md) · [ACL](./acl.md) ·
[Gateway Admin](./gateway-admin.md) · [Gotchas](./gotchas.md).

## Install

```bash
npm i @open-rlb/nestjs-amqp
```

The package depends on a few standard NestJS pieces. If they are not already in your project, add them:

```bash
npm i @nestjs/config @nestjs/axios js-yaml
# only if you use the gateway (HTTP + WebSocket):
npm i @nestjs/platform-ws
```

You also need a reachable RabbitMQ instance — that is the only external dependency for the in-memory
demo wiring shown below. ACL and gateway-admin persistence can stay fully in RAM (see their pages).

## The `nest add` schematic

The fastest way to bootstrap is the schematic. From a NestJS project root:

```bash
nest add @open-rlb/nestjs-amqp
```

It patches your project in place rather than scaffolding a new app. Concretely it:

- **`src/app.module.ts`** — adds the import line for `@open-rlb/nestjs-amqp` and inserts
  `BrokerModule.forRootAsync(...)` into the `@Module({ imports: [...] })` array. In gateway mode it also
  inserts `ProxyModule.forRootAsync(...)` and `HttpModule`. Both factories read their config from
  `@nestjs/config` (`broker`, `topics`, `app`, and for the gateway `auth-providers`, `gateway`). The
  patch is idempotent — it keys off `BrokerModule.forRootAsync` and skips if that is already present.
- **`src/main.ts`** (gateway mode only) — imports `WsAdapter`, rewrites `NestFactory.create(AppModule)`
  to `NestFactory.create(AppModule, { rawBody: true })`, and registers
  `app.useWebSocketAdapter(new WsAdapter(app))`. `rawBody` is needed for raw-body / webhook routes and
  `WsAdapter` for the gateway's WebSocket events.
- **`config/config.yaml`** — creates the file with a starter `app` / `auth-providers` / `broker` /
  `topics` block (plus a `gateway` block in gateway mode). If the file already exists, it appends only
  the top-level sections that are missing — it never overwrites your existing config.
- **`.claude/skills/`** — copies the bundled Claude skills into your project so the assistant can help
  add actions, routes and WebSocket events.

### Flags

The schematic exposes two boolean prompts/flags (both default **on**):

| Flag | Default | Effect |
| --- | --- | --- |
| `--gateway` | `true` | Wire gateway mode: `ProxyModule` + `HttpModule` in `AppModule`, the `gateway` block in `config.yaml`, and `rawBody` + `WsAdapter` in `main.ts`. Pass `--gateway=false` for a pure microservice (broker only). |
| `--skills` | `true` | Copy the Claude skill files into `.claude/skills`. Pass `--skills=false` to skip. |

```bash
# microservice only, no gateway, no skills
nest add @open-rlb/nestjs-amqp --gateway=false --skills=false
```

> The schematic also resolves `app.module.ts` and `main.ts` from the canonical `src/`-or-`app/`
> locations (falling back to a recursive search). If it cannot find them it prints a warning and leaves
> the manual wiring to you — the next section shows exactly what to add.

## Minimal manual wiring

If you prefer to wire it yourself (or the schematic could not locate your files), here is the smallest
correct setup. It is the same shape the schematic produces.

### `src/app.module.ts`

`BrokerModule` owns the broker connection, topics and app options. Add `ProxyModule` only if you want
the HTTP/WebSocket gateway; a pure microservice can omit it (and `HttpModule`).

```ts
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AppConfig,
  BrokerModule,
  BrokerTopic,
  GatewayConfig,
  HandlerAuthConfig,
  ProxyModule,
  RabbitMQConfig,
} from '@open-rlb/nestjs-amqp';
import yamlConfig from './config/config.loader';

@Module({
  imports: [
    HttpModule, // gateway only
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),

    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Route auto-discovery (publisher side), when used, lives INSIDE the `broker` block.
        options: config.get<RabbitMQConfig>('broker')!,
        topics: config.get<BrokerTopic[]>('topics')!,
        appOptions: config.get<AppConfig>('app'),
      }),
    }),

    // --- gateway only: drop this block for a pure microservice ---
    ProxyModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        authOptions: config.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: config.get<GatewayConfig>('gateway'),
      }),
      providers: [], // bind RLB_GTW_ACL_ROLE_SERVICE / RLB_GTW_METRICS_HOOK here when needed
    }),
  ],
})
export class AppModule {}
```

> The gateway's `auth-providers` and `gateway` config belong to **`ProxyModule`**, not `BrokerModule`.
> ACL and gateway-admin live in separate modules — see [ACL](./acl.md) and
> [Gateway Admin](./gateway-admin.md) for `AclModule.forRoot(...)` / `GatewayAdminModule.forRoot(...)`.

### `src/main.ts`

For the gateway you must enable `rawBody` and register the WebSocket adapter. A pure microservice can
use a plain `NestFactory.create(AppModule)`.

```ts
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  const appConfig = app.get(ConfigService).get<{ port?: number; host?: string }>('app');
  const port = Number(process.env.PORT) || appConfig?.port || 3000;
  await app.listen(port, appConfig?.host || '0.0.0.0');
}
bootstrap();
```

### `src/config/config.loader.ts`

Config is plain YAML loaded into `@nestjs/config`. A tiny loader reads the file and returns the parsed
object — every `config.get<T>('...')` call above resolves against it.

```ts
import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const YAML_CONFIG_FILENAME = 'config/config.yaml';

export default () =>
  yaml.load(readFileSync(join(process.cwd(), YAML_CONFIG_FILENAME), 'utf8')) as Record<string, any>;
```

> Adjust `YAML_CONFIG_FILENAME` to wherever your file lives relative to the process working directory
> (e.g. a monorepo app might use `apps/my-app/config/config.yaml`).

### `config/config.yaml`

A minimal config: the `app` server options, the `broker` connection with one exchange/queue, and one
`topic`. Add the `gateway` and `auth-providers` blocks only when you run the gateway.

```yaml
app:
  port: 3000
  host: 0.0.0.0
  environment: development

auth-providers: [] # gateway only — JWT/JWKS providers; see ./gateway.md

broker:
  name: rabbitmq
  uri: "amqp://guest:guest@localhost:5672/"
  defaultSubscribeErrorBehavior: ack
  defaultPublishErrorBehavior: reject
  connectionManagerOptions:
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:
      clientProperties:
        connection_name: my-service # must be distinct per instance
  exchanges:
    - name: rlb
      type: direct
      createExchangeIfNotExists: true
      options:
        durable: true
  queues:
    - name: example.queue
      exchange: rlb
      routingKey: example.queue
      createQueueIfNotExists: true
      options:
        durable: true

topics:
  - name: example.topic
    mode: rpc
    queue: example.queue
    exchange: rlb
    routingKey: example.queue

# --- gateway only ---
gateway:
  mode: gateway
  paths:
    - name: health
      method: GET
      path: /health
      dataSource: query
      topic: rlb-gateway-admin
      action: gw-health
      mode: rpc
```

> `GET /health` maps to the gateway-admin action **`gw-health`** and returns `{ status: 'ok' }` — it is a
> liveness probe, not a metrics dump.

## What's next

- [Broker](./broker.md) — topics, `@BrokerAction` / `@BrokerParam`, `BrokerService`, and the rpc / handle
  / broadcast / event modes.
- [Gateway](./gateway.md) — HTTP `paths`, WebSocket `events`, auth providers and route reloads.
- [ACL](./acl.md) — name-keyed actions/roles, grant/revoke, and the `check` endpoints.
- [Gateway Admin](./gateway-admin.md) — auth-provider CRUD, metrics, and route auto-discovery.
- [Gotchas](./gotchas.md) — the sharp edges worth reading before you ship.

← [Back to index](./README.md)
