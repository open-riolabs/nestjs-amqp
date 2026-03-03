# @open-rlb/nestjs-amqp

Quick guide for using the npm package.

Guide scope: `rpc`, `handle`, `broadcast`.

## Installation

```bash
npm i @open-rlb/nestjs-amqp
```

## Basic setup

### `AppModule`

```ts
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BrokerModule, ProxyModule } from '@open-rlb/nestjs-amqp';

@Module({
  imports: [
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        options: config.get('broker'),
        topics: config.get('topics'),
        appOptions: config.get('app'),
        authOptions: config.get('auth-providers'),
        gatewayOptions: config.get('gateway'),
      }),
    }),
    HttpModule,
    ProxyModule.forRoot([]),
  ],
})
export class AppModule {}
```

### Bootstrap

If you use `parseRaw: true` in gateway routes:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

## Minimal `config.yaml`

```yaml
# yaml-language-server: $schema=./schema.json

app:
  environment: development

broker:
  uri: "amqp://localhost/<vhost>"
  defaultSubscribeErrorBehavior: "ack"
  defaultPublishErrorBehavior: "reject"
  connectionManagerOptions:
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:
      clientProperties:
        connection_name: "connection-name"
      credentials:
        mechanism: PLAIN
        username: guest
        password: guest

  exchanges:
    - name: users-ex
      type: direct
      createExchangeIfNotExists: true
      options:
        durable: true

  queues:
    - name: users-rpc-q
      exchange: users-ex
      routingKey: users.rpc
      createQueueIfNotExists: true
      options:
        durable: true

  replyQueues:
    users-ex: users-reply-q

topics:
  - name: users-rpc
    mode: rpc
    queue: users-rpc-q

gateway:
  mode: gateway
  paths:
    - name: users-create
      method: POST
      path: /users
      dataSource: body
      topic: users-rpc
      action: user.create
      mode: rpc
  events: []
```

## Quick usage

### RPC handler with decorators

```ts
import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class UsersActionService {
  @BrokerAction('users-rpc', 'user.create', 'rpc')
  async createUser(
    @BrokerParam('body', 'email') email: string,
    @BrokerParam('body', 'role') role: string,
    @BrokerParam('header', 'X-GTW-AUTH-USERID') userId: string,
  ) {
    return { id: 'usr_1', email, role, createdBy: userId };
  }
}
```

### RPC call from code

```ts
import { Injectable } from '@nestjs/common';
import { BrokerService } from '@open-rlb/nestjs-amqp';

@Injectable()
export class UsersClientService {
  constructor(private readonly broker: BrokerService) {}

  async createUser() {
    return this.broker.requestData(
      'users-rpc',
      'user.create',
      { email: 'john@example.com', role: 'admin' },
      { 'X-Tenant': 'acme' },
      5000,
    );
  }
}
```

### Manual consumer (without decorators)

```ts
await broker.registerRpc<{ id: string }, { ok: boolean }>('health-rpc', async (event) => {
  return { ok: !!event.payload?.id };
});

await broker.registerHandler<{ invoiceId: string }>('invoice-handle', async (event) => {
  console.log(event.payload.invoiceId);
});
```

## Quick reference

### `BrokerService`

| Method                                                     | Use                             |
| ---------------------------------------------------------- | ------------------------------- |
| `requestData(topic, action, payload?, headers?, timeout?)` | RPC request/response            |
| `registerRpc(topic, handler)`                              | manual RPC consumer             |
| `registerHandler(topic, handler)`                          | `handle` / `broadcast` consumer |

### Topic types (`topics[].mode`)

| Type        | Use it when                            | Minimal config                                          | Why                                  |
| ----------- | -------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| `rpc`       | you need request/response              | `name`, `mode: rpc`, `queue` (or `exchange+routingKey`) | immediate response + timeout control |
| `handle`    | you need a worker on one queue         | `name`, `mode: handle`, `queue`                         | simple queue consumer                |
| `broadcast` | you need one message to many consumers | `name`, `mode: broadcast`, `exchange`, `routingKey`     | fanout/topic pattern                 |
| `event`     | you need publish without response      | `name`, `mode: event`, `queue` or `exchange+routingKey` | fire-and-forget (not covered here)   |

Quick snippet:

```yaml
topics:
  - name: users-rpc
    mode: rpc
    queue: users-rpc-q

  - name: invoice-handle
    mode: handle
    queue: invoice-handle-q

  - name: notify-broadcast
    mode: broadcast
    exchange: notify-ex
    routingKey: notify.#
```

### Decorators

| Decorator                                                     | Use                                  |
| ------------------------------------------------------------- | ------------------------------------ |
| `@BrokerAction(topic, action, type?)`                         | binds method to topic/action         |
| `@BrokerParam(source, name?)`                                 | maps method params from message data |
| `@BrokerAuth(authName, allowAnonymous?, roles?)`              | auth metadata                        |
| `@BrokerHTTP(method, path, dataSource?, timeout?, parseRaw?)` | HTTP metadata                        |

### `@BrokerParam` sources

| Source      | Injected value                    |
| ----------- | --------------------------------- |
| `body`      | `payload[name or parameter name]` |
| `body-full` | full payload                      |
| `header`    | `headers[name or parameter name]` |
| `tag`       | AMQP consumer tag                 |
| `action`    | message action                    |
| `topic`     | current topic                     |

### `gateway.paths[].dataSource`

| Value        | Payload                          |
| ------------ | -------------------------------- |
| `body`       | `{...params, ...body}`           |
| `query`      | `{...params, ...query}`          |
| `params`     | `params`                         |
| `body-query` | `{...params, ...query, ...body}` |
| `query-body` | `{...params, ...body, ...query}` |

### Auth providers

#### Type: `jwks`

```yaml
auth-providers:
  - name: gateway-jwks
    type: jwks
    issuer: https://issuer.example.com/realms/main
    jwksUri: https://issuer.example.com/certs
    algorithms: [RS256]
    jwtMap:
      - sub:userId
      - roles:roles
    headerPrefix: X-GTW-AUTH-
    uidClaim: USERID
    usernameClaim: USERNAME
    aclTopic: acl
    aclAction: can-user-do
```

#### Type: `jwt`

```yaml
auth-providers:
  - name: gateway-jwt
    type: jwt
    secret: your-jwt-secret
    issuer: https://issuer.example.com/realms/main
    audience: your-audience
    algorithms: [HS256]
    jwtMap:
      - sub:userId
      - roles:roles
    headerPrefix: X-GTW-AUTH-
    uidClaim: USERID
    usernameClaim: USERNAME
    aclTopic: acl
    aclAction: can-user-do
```

#### Type: `str-compare`

```yaml
auth-providers:
  - name: gateway-str
    type: str-compare
    secret: your-static-token
    headerPrefix: Bearer
```

### Gateway path (RPC)

```yaml
- name: users-create
  method: POST
  path: /users
  dataSource: body
  topic: users-rpc
  action: user.create
  mode: rpc
  timeout: 7000
```

## Common errors

- `Topic <name> not found in configuration`: check `topics[].name`, `@BrokerAction`, `requestData`, `gateway.paths[].topic`.
- `Queue <name> not found in configuration`: check that `topics[].queue` exists in `broker.queues[]`.
- `401/403` from gateway: check `gateway.paths[].auth`, `auth-providers[]`, ACL service when using `roles`.
