---
name: rlb-amqp-scaffold
description: Bootstrap a new microservice or gateway using @open-rlb/nestjs-amqp. Use when the user wants to start a new service, set up the AppModule/main.ts wiring, create the YAML config loader, or generate a starter config.yaml for an AMQP microservice and/or an HTTP+WebSocket gateway. Generates the full module wiring and a minimal-but-correct config.
---

***REMOVED*** Scaffold a @open-rlb/nestjs-amqp service

Read first:
- `.claude/skills/rlb-amqp/references/config-schema.md`
- `.claude/skills/rlb-amqp/references/gotchas.md`

Decide the role: a **microservice** (only `@BrokerAction` handlers), a **gateway**
(HTTP/WS exposure), or **both** in one app. Generate only the pieces needed.

***REMOVED******REMOVED*** 1. `src/config/config.loader.ts`

```ts
import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const YAML_CONFIG_FILENAME = 'config/config.yaml';
export default () =>
  yaml.load(readFileSync(join(process.cwd(), YAML_CONFIG_FILENAME), 'utf8')) as Record<string, any>;
```

(`js-yaml` is a dependency of the config loader; ensure it's installed.)

***REMOVED******REMOVED*** 2. `src/app.module.ts`

```ts
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig, BrokerModule, BrokerTopic, GatewayConfig, ProxyModule } from '@open-rlb/nestjs-amqp';
import { RabbitMQConfig } from '@open-rlb/nestjs-amqp/amqp-lib/config/rabbitmq.config';
import { HandlerAuthConfig } from '@open-rlb/nestjs-amqp/modules/broker/config/handler-auth.config';
import yamlConfig from './config/config.loader';
// import { MyActionService } from './my-action.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        options: config.get<RabbitMQConfig>('broker'),
        topics: config.get<BrokerTopic[]>('topics'),
        appOptions: config.get<AppConfig>('app'),
        authOptions: config.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: config.get<GatewayConfig>('gateway'),
      }),
    }),
    HttpModule,
    ProxyModule.forRoot([
      // { provide: RLB_GTW_ACL_ROLE_SERVICE, useClass: MyAclService }, // only if using `roles`
    ]),
  ],
  providers: [/* MyActionService */],
})
export class AppModule {}
```

> Omit `ProxyModule`/`HttpModule` for a pure microservice with no HTTP/WS gateway.

***REMOVED******REMOVED*** 3. `src/main.ts`

```ts
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true }); // rawBody needed if any path uses parseRaw
  app.useWebSocketAdapter(new WsAdapter(app));                        // only if using the WS gateway
  await app.listen(3000, '0.0.0.0');
}
bootstrap();
```

***REMOVED******REMOVED*** 4. `config/config.yaml` (starter)

```yaml
app:
  port: 3000
  host: 0.0.0.0
  environment: development

auth-providers: []

broker:
  uri: "amqp://guest:guest@localhost:5672/"
  defaultRpcTimeout: 10000
  defaultSubscribeErrorBehavior: ack
  connectionManagerOptions:
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:
      clientProperties:
        connection_name: my-service        ***REMOVED*** REQUIRED for broadcast/WebSocket
      credentials: { mechanism: PLAIN, username: guest, password: guest }
  exchanges:
    - name: my-ex
      type: direct
      createExchangeIfNotExists: true
      options: { durable: true }
  queues:
    - name: my-rpc-q
      exchange: my-ex
      routingKey: my.rpc
      createQueueIfNotExists: true
      options: { durable: true }

topics:
  - name: my-rpc
    mode: rpc
    queue: my-rpc-q

gateway:
  mode: gateway
  paths:
    - name: ping
      method: GET
      path: /ping
      dataSource: query
      topic: my-rpc
      action: ping
      mode: rpc
  events: []
```

***REMOVED******REMOVED*** 5. Sample handler (optional)

```ts
import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class MyActionService {
  @BrokerAction('my-rpc', 'ping', 'rpc')
  async ping(@BrokerParam('body-full') data: any) {
    return { pong: true, echo: data };
  }
}
```

***REMOVED******REMOVED*** Verify
- topic/queue/exchange names line up (gotchas 5–7); `connection_name` set if needed (8).
- `npm run build`, start the app with a reachable RabbitMQ, hit `/ping`.

After scaffolding, use `rlb-amqp-add-action` / `rlb-amqp-add-route` / `rlb-amqp-add-ws-event`
to grow the service.
