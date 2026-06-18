---
name: rlb-amqp-scaffold
description: Bootstrap a new microservice or gateway using @open-rlb/nestjs-amqp. Use when the user wants to start a new service, set up the AppModule/main.ts wiring, create the YAML config loader, or generate a starter config.yaml for an AMQP microservice and/or an HTTP+WebSocket gateway. Generates the full module wiring and a minimal-but-correct config.
---

***REMOVED*** Scaffold a @open-rlb/nestjs-amqp service

Read first:
- `.claude/skills/rlb-amqp/references/config-schema.md`
- `.claude/skills/rlb-amqp/references/gotchas.md`

Decide the role: a **microservice** (only `@BrokerAction` / `@BrokerHTTP` handlers, no
HTTP server) or a **gateway** (HTTP/WS exposure in front of microservices). Two paths:
the `nest add` schematic (fast, patches in place) or manual wiring. Canonical runnable
examples live under `sample/config-sample/` (`gateway-in-memory`, `gateway-db`,
`calculator.ms`) — mirror those, not the retired `apps/gateway-2`.

---

***REMOVED******REMOVED*** Path A — `nest add` schematic (preferred)

From a NestJS project root:

```bash
nest add @open-rlb/nestjs-amqp
```

It **patches in place** (does not scaffold a new app): edits `src/app.module.ts` and
`src/main.ts`, creates `src/config/config.loader.ts` + `config/config.yaml`, copies
RUNNABLE in-memory repositories for the selected features, adds deps, and copies the
Claude skills.

***REMOVED******REMOVED******REMOVED*** Interactive flow

1. **"Create a gateway (HTTP/WebSocket) configuration? y/N"**
2. **YES** → checkbox of gateway features:
   - `acl` — `AclModule` + ACL management/grant/check paths
   - `gateway-admin` — `GatewayAdminModule` + DB-managed routes/auth-providers/metrics paths
   - `route-reception` — gateway consumes routes auto-published by microservices
   Then prompts for names (defaults shown): exchange `rlb`, ACL queue `rlb-acl`,
   admin queue `rlb-gateway-admin`, control topic `rlb-gateway-control`,
   route exchange `rlb-route-discovery`, route queue `rlb-route-sync`.
3. **NO** (plain microservice) → checkbox:
   - `auto-config-publish` — publish this service's `@BrokerHTTP` routes to the gateway
     on boot (adds `broker.routeDiscovery`). Prompts service name + route exchange/queue.
4. "Copy the Claude skills into .claude/skills? Y/n"

***REMOVED******REMOVED******REMOVED*** Non-interactive flags (CI / scripted)

Passing `--gatewayConfig` or any `--features` skips the prompts; everything else falls
back to `rlb-*` defaults.

```bash
***REMOVED*** Gateway with ACL + admin + route reception
nest add @open-rlb/nestjs-amqp \
  --gatewayConfig --features acl --features gateway-admin --features route-reception

***REMOVED*** Plain microservice that auto-publishes its @BrokerHTTP routes on boot
nest add @open-rlb/nestjs-amqp \
  --gatewayConfig=false --features auto-config-publish \
  --serviceName my-service --routeExchange rlb-route-discovery --routeQueue rlb-route-sync
```

| Flag | Purpose |
| --- | --- |
| `--gatewayConfig` | `true` = gateway, `false` = microservice (default false non-interactive). |
| `--features <f>` | Repeatable. Gateway: `acl`, `gateway-admin`, `route-reception`. MS: `auto-config-publish`. |
| `--exchange` | Main AMQP exchange backing acl/admin queues. Default `rlb`. |
| `--aclQueue` / `--adminQueue` | Queues backing the fixed `rlb-acl` / `rlb-gateway-admin` topics. |
| `--controlTopic` | Broadcast control/reload topic. Default `rlb-gateway-control`. |
| `--routeExchange` / `--routeQueue` | Route-discovery exchange/queue. Defaults `rlb-route-discovery` / `rlb-route-sync` — **must match both publisher and gateway**. |
| `--serviceName` | Route-publish ownership key + AMQP `connection_name`. Default = project name. |
| `--skills` | Copy Claude skills. Default `true`; `--skills=false` to skip. |

> `app.module.ts` patch is idempotent (keys off `BrokerModule.forRootAsync`). If it can't
> locate `app.module.ts` / `main.ts` it warns and leaves you the manual wiring below.

After scaffolding, edit `config/config.yaml` (fill `<AMQP_URI>` / credentials) and replace
the `<APP_NAME>` `connection_name` placeholder. Then use `rlb-amqp-add-action` /
`rlb-amqp-add-route` / `rlb-amqp-add-ws-event` to grow the service.

---

***REMOVED******REMOVED*** Path B — manual wiring

Mirrors `sample/config-sample/gateway-in-memory` (gateway) and `calculator.ms` (pure MS).

***REMOVED******REMOVED******REMOVED*** 1. `src/config/config.loader.ts`

```ts
import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const YAML_CONFIG_FILENAME = 'config/config.yaml';

export default () =>
  yaml.load(readFileSync(join(process.cwd(), YAML_CONFIG_FILENAME), 'utf8')) as Record<string, any>;
```

(`js-yaml` + `@nestjs/config` are deps; the gateway also needs `@nestjs/axios`,
`@nestjs/platform-ws`, `@nestjs/websockets`, `ws`.)

***REMOVED******REMOVED******REMOVED*** 2. `src/app.module.ts`

```ts
import { HttpModule } from '@nestjs/axios';            // gateway only
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AppConfig, BrokerModule, BrokerTopic, RabbitMQConfig,
  GatewayConfig, HandlerAuthConfig, ProxyModule,       // gateway only
} from '@open-rlb/nestjs-amqp';
import yamlConfig from './config/config.loader';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        // broker.routeDiscovery (publisher side), when used, lives INSIDE this `broker` block.
        options: config.get<RabbitMQConfig>('broker')!,
        topics: config.get<BrokerTopic[]>('topics')!,
        appOptions: config.get<AppConfig>('app'),
      }),
    }),

    // --- gateway only: omit ProxyModule + HttpModule for a pure microservice ---
    HttpModule,
    ProxyModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        authOptions: config.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: config.get<GatewayConfig>('gateway'),
      }),
      providers: [
        // Role-gated paths resolve the caller's roles in-process via this token (NO broker hop):
        // { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService }, // required if any path uses `roles`
        // Optional in-proxy per-request metrics hook (independent of gateway.metrics):
        // { provide: RLB_GTW_METRICS_HOOK, useClass: InfluxMetricsHook },
      ],
    }),
  ],
  providers: [/* AppService — your @BrokerAction / @BrokerHTTP handlers */],
})
export class AppModule {}
```

> The gateway's `auth-providers` + `gateway` config belong to **`ProxyModule`**, not
> `BrokerModule`. For ACL add `AclModule.forRoot([...repos], { cache })` and bind
> `RLB_GTW_ACL_ROLE_SERVICE`; for DB routes/auth/metrics add
> `GatewayAdminModule.forRoot([...repos])` — see the `gateway-in-memory` sample and the
> ACL / Gateway Admin docs.

***REMOVED******REMOVED******REMOVED*** 3. `src/main.ts`

**Gateway** (needs `rawBody` + `WsAdapter`):

```ts
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true }); // rawBody: raw-body/webhook routes
  app.useWebSocketAdapter(new WsAdapter(app));                        // WS events
  app.enableShutdownHooks();
  const cfg = app.get(ConfigService).get<{ port?: number; host?: string }>('app');
  await app.listen(Number(process.env.PORT) || cfg?.port || 3000, cfg?.host || '0.0.0.0');
}
bootstrap();
```

**Pure microservice** (no HTTP server — `init()`, not `listen()`):

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();       // drain in-flight RPC + close AMQP cleanly on SIGINT/SIGTERM
  await app.init();                // @BrokerAction handlers start consuming once initialized
}
bootstrap();
```

***REMOVED******REMOVED******REMOVED*** 4. `config/config.yaml` (starter)

```yaml
app:
  port: 3000
  host: 0.0.0.0
  environment: development

auth-providers: []   ***REMOVED*** gateway only — JWT/JWKS providers

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
        connection_name: my-service     ***REMOVED*** distinct per instance; needed for broadcast/WebSocket
      credentials: { mechanism: PLAIN, username: guest, password: guest }
  exchanges:
    - name: rlb
      type: direct
      createExchangeIfNotExists: true
      options: { durable: true }
  queues:
    - name: my-rpc-q
      exchange: rlb
      routingKey: my-rpc-q
      createQueueIfNotExists: true
      options: { durable: true }

topics:
  - name: my-rpc
    mode: rpc
    queue: my-rpc-q
    exchange: rlb
    routingKey: my-rpc-q

***REMOVED*** --- gateway only ---
gateway:
  mode: gateway
  events: []
  paths:
    - name: health
      method: GET
      path: /health
      dataSource: query
      topic: rlb-gateway-admin       ***REMOVED*** gateway-admin gw-health → 200 { status: 'ok' }
      action: gw-health
      mode: rpc
```

***REMOVED******REMOVED******REMOVED*** Route auto-discovery (publisher side, optional)

A microservice can announce its `@BrokerHTTP` routes on boot. Add INSIDE the `broker`
block — `serviceName` is the ownership key AND fills `connection_name` when none is set
explicitly. `exchange`/`queue` default to `rlb-route-discovery` / `rlb-route-sync` and
must match the gateway's `GatewayAdminModule` `routeDiscovery { exchange, queue }`.

```yaml
broker:
  ***REMOVED*** ...
  routeDiscovery:
    serviceName: my-service
    publishOnBoot: true
    ***REMOVED*** exchange: rlb-route-discovery   ***REMOVED*** override to namespace per env (must match the gateway)
    ***REMOVED*** queue: rlb-route-sync
```

***REMOVED******REMOVED******REMOVED*** 5. Sample handler (one method, both transports)

```ts
import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerHTTP, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class AppService {
  @BrokerAction('my-rpc', 'ping')                 // AMQP RPC on topic my-rpc, action ping
  @BrokerHTTP('POST', '/ping', 'body')            // route metadata for gateway auto-discovery
  async ping(@BrokerParam('body', 'name') name: string) {  // flat params, one decorator each
    return { pong: true, name };
  }
}
```

***REMOVED******REMOVED*** Verify
- topic/queue/exchange names line up across `broker`/`topics`/paths (gotchas 5–7);
  `connection_name` set if using broadcast/WebSocket (8).
- Route-discovery `exchange`/`queue` identical on publisher and gateway.
- Reload DB routes at runtime via the `gw-reload` action on the broadcast control topic
  (default `rlb-gateway-control`).
- `npm run build`, start with a reachable RabbitMQ, hit `/health` (gateway) or publish to
  the RPC topic (microservice).

After scaffolding, use `rlb-amqp-add-action` / `rlb-amqp-add-route` /
`rlb-amqp-add-ws-event` to grow the service.
