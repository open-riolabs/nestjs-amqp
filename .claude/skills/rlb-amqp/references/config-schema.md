***REMOVED*** config.yaml — full schema

Five top-level sections: `app`, `broker`, `topics`, `auth-providers`, `gateway`.
Loaded by `config/config.loader.ts`. `app`/`broker`/`topics` go to `BrokerModule.forRootAsync`;
`auth-providers` + `gateway` go to `ProxyModule.forRootAsync` (see the repo `README.md` Quick start).

---

***REMOVED******REMOVED*** app

```yaml
app:
  port: 3000
  host: 0.0.0.0
  environment: development   ***REMOVED*** development | production — controls error detail exposed by the gateway
```

`AppConfig` = `{ environment, port?, host? }`. In `production` gateway errors are reduced
to `{ message, name }`; in `development` the full detail/stack is included.

---

***REMOVED******REMOVED*** broker  (RabbitMQConfig)

```yaml
broker:
  name: rabbitmq
  uri: "amqp://user:pass@host:5672/vhost"     ***REMOVED*** string | string[] (failover)
  prefetchCount: 10
  defaultRpcTimeout: 10000                      ***REMOVED*** ms
  defaultSubscribeErrorBehavior: ack            ***REMOVED*** ack | reject | requeue
  defaultPublishErrorBehavior: reject

  connectionManagerOptions:                     ***REMOVED*** amqp-connection-manager options
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:
      clientProperties:
        connection_name: my-service             ***REMOVED*** REQUIRED for broadcast + WebSocket gateway
      credentials:
        mechanism: PLAIN                         ***REMOVED*** PLAIN | EXTERNAL | AMQPLAIN (case-insensitive)
        username: guest
        password: guest

  exchanges:                                    ***REMOVED*** RabbitMQExchangeConfig[]
    - name: users-ex
      type: direct                               ***REMOVED*** direct | topic | fanout | headers
      createExchangeIfNotExists: true            ***REMOVED*** false → checkExchange (must pre-exist)
      options: { durable: true, autoDelete: false, internal: false }

  queues:                                       ***REMOVED*** RabbitMQQueueConfig[]
    - name: users-rpc-q
      exchange: users-ex
      routingKey: users.rpc                       ***REMOVED*** string | string[]; REQUIRED if exchange type == topic
      createQueueIfNotExists: true
      options: { durable: true, exclusive: false, autoDelete: false }
      consumerTag: my-tag                         ***REMOVED*** optional, must be unique per channel

  replyQueues:                                  ***REMOVED*** map exchange → reply queue (RPC responses)
    users-ex: users-reply-q                       ***REMOVED*** omit → RabbitMQ direct-reply-to is used
```

Notes:
- `exchanges[]` and `queues[]` are asserted/checked once at boot on the default channel.
- `replyQueues` values are auto-consumed at boot.
- Queue `options` is amqplib `Options.AssertQueue` (durable, exclusive, autoDelete,
  messageTtl, deadLetterExchange, maxLength, maxPriority, arguments, ...).

---

***REMOVED******REMOVED*** topics  (BrokerTopic[])

A topic maps a logical name to an AMQP path. `mode` decides the semantics.

```yaml
topics:
  - name: users-rpc          ***REMOVED*** logical name (must match @BrokerAction / requestData / gateway)
    mode: rpc                 ***REMOVED*** rpc | handle | broadcast | event
    queue: users-rpc-q        ***REMOVED*** for rpc/handle: must exist in broker.queues[]
    exchange: users-ex        ***REMOVED*** for broadcast/event (direct exchange path)
    routingKey: users.rpc     ***REMOVED*** for broadcast/event / topic exchanges
    toObservable: false       ***REMOVED*** handle only: route to BrokerService.events$ instead of a handler
```

| mode        | required fields                                  | notes                                  |
| ----------- | ------------------------------------------------ | -------------------------------------- |
| `rpc`       | `name`, `queue` (or `exchange`+`routingKey`)     | request/response + timeout             |
| `handle`    | `name`, `queue`                                  | simple queue worker                    |
| `broadcast` | `name`, `exchange`, `routingKey`                 | fanout/topic; needs `connection_name`  |
| `event`     | `name`, `queue` OR `exchange`+`routingKey`       | fire-and-forget                        |

> A single `@BrokerAction` topic registers ONE consumer; multiple actions on the same
> topic share it and are dispatched by `action`.

---

***REMOVED******REMOVED*** auth-providers  (HandlerAuthConfig[])

```yaml
auth-providers:
  - name: gateway-jwks
    type: jwks                       ***REMOVED*** jwt | jwks | basic | str-compare | none
    issuer: https://issuer/realms/x
    jwksUri: https://issuer/certs    ***REMOVED*** jwks only
    secret: s3cr3t                   ***REMOVED*** jwt / str-compare only
    audience: my-aud                 ***REMOVED*** jwt only
    algorithms: [RS256]
    httpsAllowUnauthorized: false    ***REMOVED*** true ONLY for self-signed dev issuers
    clientId: u                      ***REMOVED*** basic only
    clientSecret: p                  ***REMOVED*** basic only
    jwtMap: [sub:userId, roles:roles]***REMOVED*** tokenClaim:destClaim  (dest is header-prefixed + uppercased)
    headerPrefix: X-GTW-AUTH-        ***REMOVED*** prefix of headers propagated to microservices
    uidClaim: USERID                 ***REMOVED*** dest used as user id for ACL
    usernameClaim: USERNAME
    aclTopic: acl                    ***REMOVED*** RPC topic queried for roles
    aclAction: can-user-do
```

Mapping example: token `{ sub: "u_1" }` + `jwtMap: [sub:userId]` + `headerPrefix: X-GTW-AUTH-`
→ header `X-GTW-AUTH-USERID = u_1`. Read it in a handler with
`@BrokerParam('header', 'X-GTW-AUTH-USERID')`.

Types: `jwt` (HS/RS secret), `jwks` (remote keys), `basic` (clientId/clientSecret),
`str-compare` (static token after `headerPrefix` in Authorization).

Provider notes: `algorithms` is REQUIRED for `jwt`/`jwks` (omit → denied; `jwks` allows only
RS*/ES*/PS*, rejects HS*/none). `str-compare` without `secret` and `basic` without
`clientSecret` PASS THROUGH (request treated as authenticated — provider effectively open).
Define `jwtMap` to avoid forwarding unmapped claims.

---

***REMOVED******REMOVED*** gateway  (GatewayConfig)

```yaml
gateway:
  mode: gateway
  headerPrefix: X-GTW-               ***REMOVED*** prefix for forwarded request headers (forwardHeaders)

  ws:                                ***REMOVED*** WebSocketGatewayOptions — connection-level only
    maxConnections: 5000
    maxSubscriptionsPerClient: 50
    heartbeatIntervalMs: 30000
    allowedOrigins: [https://app.example.com]   ***REMOVED*** Origin allowlist (omit → all accepted)
    maxMessageBytes: 16384                        ***REMOVED*** drop oversized client frames (default 16KB)
    ***REMOVED*** auth/roles/scope are declared PER-EVENT on events[], not here

  loadConfig:                        ***REMOVED*** optional remote load via RPC at boot
    paths:  { topic: gtw.config, action: get-paths }
    events: { topic: gtw.config, action: get-events }

  paths:   [ ... ]                   ***REMOVED*** PathDefinition[] (HTTP routes) — see below
  events:  [ ... ]                   ***REMOVED*** WebSocketEvent[] (WS / webhook) — see below
```

***REMOVED******REMOVED******REMOVED*** gateway.paths[]  (PathDefinition — HTTP routes)

```yaml
- name: users-create
  method: POST              ***REMOVED*** GET | POST | PUT | DELETE | PATCH
  path: /users/:tenant?     ***REMOVED*** Express route, params supported
  dataSource: body          ***REMOVED*** body | query | params | body-query | query-body
  topic: users-rpc
  action: user.create
  mode: rpc                 ***REMOVED*** rpc | event
  timeout: 7000             ***REMOVED*** rpc only (ms)
  auth: gateway-jwks        ***REMOVED*** auth-provider name
  allowAnonymous: false     ***REMOVED*** true → allow even without valid auth
  roles: [users.create]     ***REMOVED*** requires IAclRoleService
  successStatusCode: 201
  binary: false             ***REMOVED*** true → response sent as base64-decoded Buffer
  redirect: 302             ***REMOVED*** if set → redirect to the URL contained in the reply
  parseRaw: false           ***REMOVED*** true → forward raw body as $raw (needs rawBody:true in bootstrap)
  headers: { Cache-Control: no-store }    ***REMOVED*** static response headers
  forwardHeaders: { Tenant: x-tenant }    ***REMOVED*** request header → forwarded to the microservice
```

dataSource payload composition:

| value        | payload                          |
| ------------ | -------------------------------- |
| `body`       | `{...params, ...body}`           |
| `query`      | `{...params, ...query}`          |
| `params`     | `params`                         |
| `body-query` | `{...params, ...query, ...body}` |
| `query-body` | `{...params, ...body, ...query}` |

Route params are re-applied last (win on key collisions). Uploads → `$files`, raw → `$raw`.
Error `name` → HTTP status: BadRequestError/InvalidParamsErrror→400, UnauthorizedError→401,
ForbiddenError→403, NotFoundError→404, else→500. `mode: event` confirm failure → 503.

***REMOVED******REMOVED******REMOVED*** gateway.events[]  (WebSocketEvent — WS / webhook)

```yaml
- name: orders
  type: ws                 ***REMOVED*** ws | http (webhook)
  exchange: orders-ex
  routingKey: orders.***REMOVED***
  auth: gateway-jwks       ***REMOVED*** provider that verifies the token + maps claims FOR THIS event (at subscribe)
  requireAuth: true        ***REMOVED*** default true when `auth` is set; false → auth optional (anon allowed)
  roles: [orders.read]     ***REMOVED*** ACL check via IAclRoleService
  scopeClaim: X-GTW-AUTH-USERID   ***REMOVED*** forward only messages of this user...
  payloadKey: userId              ***REMOVED*** ...where payload.userId === the mapped claim value
  ***REMOVED*** type: http only:
  url: https://hooks.example.com/orders
  method: POST
  timeout: 8000
  headers: { Authorization: "Bearer ..." }
```

WS client connects with the JWT in the subprotocol: `new WebSocket(url, [token])`. The token
is verified per-event with `events[].auth`'s provider (memoized per provider per connection).
Client protocol: `{action:'subscribe'|'unsubscribe', topic, select?}`; inbound messages
arrive as `{ topic: 'on<Name>', data }`, errors as `{ topic:'onError', data:{event,error} }`.
