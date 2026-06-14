***REMOVED*** @open-rlb/nestjs-amqp

Libreria **NestJS** che fornisce un'astrazione di alto livello su **RabbitMQ/AMQP**, più un **API Gateway HTTP/WebSocket** che traduce le richieste esterne in messaggi sul broker.

È il cuore di un'architettura a microservizi event-driven: i servizi comunicano tra loro via RabbitMQ con semplici decoratori, e un gateway espone tutto al mondo esterno via HTTP/WS, il tutto guidato dalla configurazione YAML.

```bash
npm i @open-rlb/nestjs-amqp
```

***REMOVED******REMOVED******REMOVED*** Installazione automatica (`nest add`)

Uno **schematic** wira la libreria nel tuo progetto NestJS: aggiunge i moduli all'`AppModule`, crea il config loader e un `config.yaml`, copia le **skill Claude** in `.claude/skills/` e — in base alla modalità gateway — include o meno la parte HTTP/WebSocket (sia nello YAML sia nella factory dei moduli).

```bash
***REMOVED*** con gateway HTTP/WebSocket (default)
nest add @open-rlb/nestjs-amqp

***REMOVED*** solo microservizio AMQP (niente gateway)
nest g @open-rlb/nestjs-amqp:nest-add --gateway=false
```

Opzioni: `--gateway` (on/off, default on), `--module` (default `src/app.module.ts`), `--main` (default `src/main.ts`), `--config` (default `config/config.yaml`), `--skills` (copia le skill, default on), `--skip-install`.

Con `--gateway=false` la factory passa a `BrokerModule` solo `{ options, topics, appOptions }` e non importa `ProxyModule`/`HttpModule`; con il gateway attivo aggiunge `ProxyModule.forRootAsync(...)` (che riceve `authOptions` + `gatewayOptions`), `HttpModule` e il `WsAdapter` in `main.ts`. Lo schematic è idempotente (non tocca un `AppModule` che già importa `BrokerModule`).

> Documentazione completa. Indice:
> [Architettura](***REMOVED***architettura) ·
> [Quick start](***REMOVED***quick-start) ·
> [Configurazione](***REMOVED***configurazione-completa) ·
> [Scrivere un microservizio (AMQP)](***REMOVED***scrivere-un-microservizio-amqp) ·
> [Gateway HTTP](***REMOVED***gateway-http) ·
> [Gateway WebSocket](***REMOVED***gateway-websocket) ·
> [Remote config](***REMOVED***remote-config) ·
> [API `BrokerService`](***REMOVED***api-brokerservice) ·
> [⚠️ Gotcha e casi a rischio bug](***REMOVED***️-gotcha-e-casi-a-rischio-bug) ·
> [Errori comuni](***REMOVED***errori-comuni)

---

***REMOVED******REMOVED*** Architettura

Monorepo NestJS (vedi `nest-cli.json`):

| Progetto                 | Tipo        | Descrizione                                      |
| ------------------------ | ----------- | ------------------------------------------------ |
| `libs/rlb-nestjs-amqp`   | library     | La libreria vera e propria (il prodotto npm)     |
| `apps/gateway`           | application | App di esempio/riferimento che usa la libreria   |

```
┌─────────────────────────────────────────────────────────┐
│  Client esterni (HTTP, WebSocket)                        │
└───────────────┬─────────────────────────────────────────┘
                │
        ┌───────▼────────┐   modules/proxy  ── Gateway
        │ HttpHandler    │   - registra route HTTP dinamiche
        │ WebSocketSvc   │   - auth (jwt/jwks/basic/str-compare) + ACL/ruoli
        │ JwtService     │   - traduce HTTP/WS → messaggi broker
        └───────┬────────┘
                │
        ┌───────▼────────┐   modules/broker  ── Astrazione AMQP
        │ BrokerService  │   - rpc / handle / broadcast / event
        │ MetadataScanner│   - decoratori @BrokerAction / @BrokerParam
        │ HandlerRegistry│   - auto-discovery dei metodi via reflect-metadata
        └───────┬────────┘
                │
        ┌───────▼────────┐   amqp-lib  ── Driver AMQP a basso livello
        │ AmqpConnection │   - connessione gestita (riconnessione, canali)
        │                │   - publish/consume, RPC con correlationId, Nack
        └───────┬────────┘
                │
          ┌─────▼─────┐
          │ RabbitMQ  │
          └───────────┘
```

***REMOVED******REMOVED******REMOVED*** I tre strati

1. **`amqp-lib`** — driver a basso livello (`AmqpConnection`): connessione resiliente (`amqp-connection-manager`), canali gestiti, setup di exchange/queue/binding al boot, RPC con `correlationId` + *direct-reply-to*, consumer con gestione errori (`Nack` → ack/reject/requeue), graceful shutdown.
2. **`modules/broker`** — astrazione di business: `BrokerService`, decoratori `@BrokerAction`/`@BrokerParam`, `MetadataScannerService` (auto-discovery dei metodi decorati e registrazione automatica dei consumer).
3. **`modules/proxy`** — gateway HTTP/WebSocket: registrazione dinamica di route Express, auth pluggable, ACL/ruoli, WebSocket sicuro e scalabile, forwarding webhook.

***REMOVED******REMOVED******REMOVED*** Flusso di una richiesta

```
HTTP/WS request → Gateway → (RPC | event) su RabbitMQ → microservizio (@BrokerAction)
              → risposta (solo RPC) → HTTP/WS response
```

---

***REMOVED******REMOVED*** Quick start

***REMOVED******REMOVED******REMOVED*** 1. `AppModule`

```ts
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig, BrokerModule, BrokerTopic, GatewayConfig, ProxyModule } from '@open-rlb/nestjs-amqp';
import { RabbitMQConfig } from '@open-rlb/nestjs-amqp/amqp-lib/config/rabbitmq.config';
import { HandlerAuthConfig } from '@open-rlb/nestjs-amqp/modules/broker/config/handler-auth.config';
import yamlConfig from './config/config.loader';

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
      }),
    }),
    HttpModule,
    // auth-providers + gateway config → ProxyModule (non più BrokerModule)
    ProxyModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        authOptions: config.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: config.get<GatewayConfig>('gateway'),
      }),
      providers: [
        // { provide: RLB_GTW_ACL_ROLE_SERVICE, useClass: MyAclService }, // solo se usi `roles`
      ],
    }),
  ],
})
export class AppModule {}
```

***REMOVED******REMOVED******REMOVED*** 2. Bootstrap (`main.ts`)

```ts
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true è OBBLIGATORIO se usi parseRaw nelle route del gateway
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useWebSocketAdapter(new WsAdapter(app)); // solo se usi il gateway WebSocket
  await app.listen(3000, '0.0.0.0');
}
bootstrap();
```

***REMOVED******REMOVED******REMOVED*** 3. Config loader (`config/config.loader.ts`)

```ts
import { readFileSync } from 'fs';
import * as yaml from 'js-yaml';
import { join } from 'path';

const YAML_CONFIG_FILENAME = 'config/config.yaml';

export default () =>
  yaml.load(readFileSync(join(process.cwd(), YAML_CONFIG_FILENAME), 'utf8')) as Record<string, any>;
```

---

***REMOVED******REMOVED*** Configurazione completa

Il file `config.yaml` ha cinque sezioni di primo livello: `app`, `broker`, `topics`, `auth-providers`, `gateway`.

***REMOVED******REMOVED******REMOVED*** `app`

```yaml
app:
  port: 3000
  host: 0.0.0.0
  environment: development   ***REMOVED*** 'development' | 'production' (controlla il dettaglio degli errori esposti)
```

> In `production` gli errori restituiti dal gateway sono ridotti a `{ message, name }`; in `development` viene incluso lo stack/dettaglio. Vedi `UtilsService.error2Object`.

***REMOVED******REMOVED******REMOVED*** `broker`

```yaml
broker:
  name: rabbitmq
  uri: "amqp://user:pass@localhost:5672/vhost"   ***REMOVED*** stringa o array di URI (failover)
  prefetchCount: 10
  defaultRpcTimeout: 10000                        ***REMOVED*** ms, default per requestData
  defaultSubscribeErrorBehavior: ack              ***REMOVED*** ack | reject | requeue (comportamento di default sugli errori consumer)

  connectionManagerOptions:                       ***REMOVED*** opzioni amqp-connection-manager
    heartbeatIntervalInSeconds: 60
    reconnectTimeInSeconds: 60
    connectionOptions:
      clientProperties:
        connection_name: my-service               ***REMOVED*** OBBLIGATORIO per broadcast e per il gateway WebSocket
      credentials:
        mechanism: PLAIN                          ***REMOVED*** PLAIN | EXTERNAL | AMQPLAIN
        username: guest
        password: guest

  exchanges:
    - name: users-ex
      type: direct                                ***REMOVED*** direct | topic | fanout | headers
      createExchangeIfNotExists: true             ***REMOVED*** false → checkExchange (deve già esistere)
      options: { durable: true }

  queues:
    - name: users-rpc-q
      exchange: users-ex
      routingKey: users.rpc                        ***REMOVED*** string | string[]; OBBLIGATORIO se exchange è di tipo `topic`
      createQueueIfNotExists: true
      options: { durable: true }

  replyQueues:                                    ***REMOVED*** mappa exchange → reply queue per le risposte RPC
    users-ex: users-reply-q                       ***REMOVED*** se omesso si usa la direct-reply-to di RabbitMQ
```

***REMOVED******REMOVED******REMOVED*** `topics`

Un topic mappa un nome logico (azione/microservizio) su un percorso AMQP. Il `mode` decide la semantica.

| `mode`      | Quando usarlo                          | Campi richiesti                                         | Semantica                            |
| ----------- | -------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| `rpc`       | request/response                       | `name`, `queue` (o `exchange`+`routingKey`)             | risposta immediata + timeout         |
| `handle`    | worker su una coda                     | `name`, `queue`                                         | consumer di coda semplice            |
| `broadcast` | un messaggio a molti consumer          | `name`, `exchange`, `routingKey`                        | fanout/topic; richiede `connection_name` |
| `event`     | publish senza risposta                 | `name`, `queue` **oppure** `exchange`+`routingKey`      | fire-and-forget                      |

```yaml
topics:
  - name: users-rpc
    mode: rpc
    queue: users-rpc-q          ***REMOVED*** deve esistere in broker.queues[]

  - name: invoice-handle
    mode: handle
    queue: invoice-handle-q

  - name: notify-broadcast
    mode: broadcast
    exchange: notify-ex
    routingKey: notify.***REMOVED***

  - name: audit-event
    mode: event
    exchange: audit-ex
    routingKey: audit.created
```

> `toObservable: true` su un topic `handle` instrada i messaggi su `BrokerService.events$` (Observable RxJS) invece che a un handler registrato.

***REMOVED******REMOVED******REMOVED*** `auth-providers`

Provider di autenticazione usati dalle route del gateway (`gateway.paths[].auth`) e dagli eventi WebSocket (`gateway.events[].auth`).

```yaml
auth-providers:
  - name: gateway-jwks
    type: jwks                                    ***REMOVED*** jwt | jwks | basic | str-compare | none
    issuer: https://issuer.example.com/realms/main
    jwksUri: https://issuer.example.com/certs
    algorithms: [RS256]
    httpsAllowUnauthorized: false                 ***REMOVED*** true SOLO per issuer self-signed in dev
    jwtMap:                                        ***REMOVED*** claim del token → claim mappato (header-prefixed)
      - sub:userId
      - roles:roles
    headerPrefix: X-GTW-AUTH-                      ***REMOVED*** prefisso degli header propagati ai microservizi
    uidClaim: USERID                              ***REMOVED*** dest (uppercase) usato come user id per l'ACL
    usernameClaim: USERNAME
    aclTopic: acl                                 ***REMOVED*** topic RPC interrogato per i ruoli
    aclAction: can-user-do

  - name: gateway-jwt
    type: jwt
    secret: your-jwt-secret
    issuer: https://issuer.example.com/realms/main
    audience: your-audience
    algorithms: [HS256]
    jwtMap: [sub:userId, roles:roles]
    headerPrefix: X-GTW-AUTH-
    uidClaim: USERID
    usernameClaim: USERNAME
    aclTopic: acl
    aclAction: can-user-do

  - name: gateway-basic
    type: basic
    clientId: my-user
    clientSecret: my-pass
    headerPrefix: X-GTW-AUTH-

  - name: gateway-str
    type: str-compare
    secret: your-static-token
    headerPrefix: Bearer                          ***REMOVED*** prefisso atteso nell'header Authorization
```

Mapping dei claim: un token con `{ sub: "u_1", roles: [...] }` e `jwtMap: [sub:userId]`, `headerPrefix: X-GTW-AUTH-` produce l'header `X-GTW-AUTH-USERID = u_1` propagato al microservizio. Leggilo con `@BrokerParam('header', 'X-GTW-AUTH-USERID')`.

> **Sicurezza dei provider**: `algorithms` è **obbligatorio** per `jwt`/`jwks` (se omesso la verifica è negata → previene l'algorithm-confusion); per `jwks` solo algoritmi asimmetrici (RS\*/ES\*/PS\*), `HS*`/`none` rifiutati. `str-compare` senza `secret` e `basic` senza `clientSecret` fanno **pass-through** (richiesta considerata autenticata — provider di fatto aperto/disabilitato; usalo consapevolmente). Senza `jwtMap` i claim vengono propagati non mappati: definiscilo sempre.

***REMOVED******REMOVED******REMOVED*** `gateway`

```yaml
gateway:
  mode: gateway
  headerPrefix: X-GTW-                            ***REMOVED*** prefisso per gli header inoltrati (forwardHeaders)

  ws:                                             ***REMOVED*** opzioni WebSocket — solo livello connessione
    maxConnections: 5000
    maxSubscriptionsPerClient: 50
    heartbeatIntervalMs: 30000
    ***REMOVED*** auth/roles/scope sono dichiarati PER-EVENTO (events[].auth/requireAuth/roles/...)

  loadConfig:                                     ***REMOVED*** caricamento remoto di paths/events via RPC (opzionale)
    paths: { topic: gtw.config, action: get-paths }
    events: { topic: gtw.config, action: get-events }

  paths:    [ ... ]                               ***REMOVED*** vedi "Gateway HTTP"
  events:   [ ... ]                               ***REMOVED*** vedi "Gateway WebSocket"
```

---

***REMOVED******REMOVED*** Scrivere un microservizio (AMQP)

***REMOVED******REMOVED******REMOVED*** Handler con i decoratori

```ts
import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class UsersActionService {
  // @BrokerAction(topic, action, type?) — il `type` è documentativo: l'handler è
  // SEMPRE raggiungibile sia in rpc sia in event (vedi "Doppio comportamento").
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

Registra il servizio come provider in un modulo NestJS qualunque: il `MetadataScannerService` lo scopre all'avvio e registra automaticamente il consumer per il topic.

***REMOVED******REMOVED******REMOVED******REMOVED*** Sorgenti `@BrokerParam(source, name?)`

| Source      | Valore iniettato                                      |
| ----------- | ----------------------------------------------------- |
| `body`      | `payload[name ?? nomeParametro]`                      |
| `body-full` | payload completo                                      |
| `header`    | `headers[name ?? nomeParametro]`                      |
| `tag`       | consumer tag AMQP                                     |
| `action`    | action del messaggio                                  |
| `topic`     | topic corrente                                        |

> Se ometti `@BrokerParam` su un parametro, il default è `{ source: 'body' }` con chiave = nome del parametro.

***REMOVED******REMOVED******REMOVED*** Doppio comportamento RPC / event

Ogni `@BrokerAction` è eseguibile **sia in RPC sia in event**, senza modifiche al servizio. Cambia solo cosa attende il chiamante.

| Modalità | Come si invoca                                    | Cosa si attende                                          |
| -------- | ------------------------------------------------- | ------------------------------------------------------- |
| `rpc`    | `broker.requestData(...)` / path `mode: rpc`      | la **risposta** del metodo (request/response)           |
| `event`  | `broker.publishMessage(...)` / path `mode: event` | solo che il **broker prenda in carico** (publisher confirm) |

`publishMessage` è `async` e si risolve solo al publisher confirm (rigetta su nack/errore). Sul gateway, una path `mode: event` risponde `202` **dopo** il confirm e `503` se il broker non accetta.

```yaml
***REMOVED*** Lo stesso topic/action esposto nei due modi
gateway:
  paths:
    - { name: users-create-sync,  method: POST, path: /users,       topic: users-rpc, action: user.create, mode: rpc }
    - { name: users-create-async, method: POST, path: /users/async, topic: users-rpc, action: user.create, mode: event }
```

***REMOVED******REMOVED******REMOVED*** Consumer manuali (senza decoratori)

```ts
// RPC
await broker.registerRpc<{ id: string }, { ok: boolean }>('health-rpc', async (event) => {
  return { ok: !!event.payload?.id };
});

// handle / broadcast (gli handler devono restituire void)
await broker.registerHandler<{ invoiceId: string }>('invoice-handle', async (event) => {
  console.log(event.payload.invoiceId);
});
```

***REMOVED******REMOVED******REMOVED*** Pubblicare / chiamare da codice

```ts
@Injectable()
export class UsersClient {
  constructor(private readonly broker: BrokerService) {}

  // RPC: attende la risposta
  createUserRpc() {
    return this.broker.requestData('users-rpc', 'user.create',
      { email: 'a@b.c', role: 'admin' }, { 'X-Tenant': 'acme' }, 5000);
  }

  // Event: attende solo che il broker prenda in carico
  async emitAudit() {
    await this.broker.publishMessage('audit-event', 'audit.created', { entity: 'user', id: 'u_1' });
  }
}
```

---

***REMOVED******REMOVED*** Gateway HTTP

Le route sono dichiarate in `gateway.paths[]` e registrate dinamicamente su Express al boot.

```yaml
gateway:
  paths:
    - name: users-create
      method: POST                 ***REMOVED*** GET | POST | PUT | DELETE | PATCH
      path: /users/:tenant?        ***REMOVED*** supporta route param Express
      dataSource: body             ***REMOVED*** body | query | params | body-query | query-body
      topic: users-rpc
      action: user.create
      mode: rpc                    ***REMOVED*** rpc | event
      timeout: 7000                ***REMOVED*** solo rpc
      auth: gateway-jwks           ***REMOVED*** nome di un auth-provider
      allowAnonymous: false        ***REMOVED*** true → consente l'accesso anche senza auth valida
      roles: [users.create]        ***REMOVED*** richiede un IAclRoleService registrato
      successStatusCode: 201
      binary: false                ***REMOVED*** true → risposta come Buffer base64-decoded
      redirect: 302                ***REMOVED*** se valorizzato, redirect alla URL contenuta nella risposta
      headers: { Cache-Control: no-store }   ***REMOVED*** header statici sulla risposta
      forwardHeaders: { Tenant: x-tenant }   ***REMOVED*** header della richiesta da inoltrare al microservizio
      parseRaw: false              ***REMOVED*** true → inoltra il body raw come $raw (richiede rawBody:true nel bootstrap)
```

***REMOVED******REMOVED******REMOVED******REMOVED*** Composizione del payload (`dataSource`)

| Valore       | Payload inviato al broker        |
| ------------ | -------------------------------- |
| `body`       | `{...params, ...body}`           |
| `query`      | `{...params, ...query}`          |
| `params`     | `params`                         |
| `body-query` | `{...params, ...query, ...body}` |
| `query-body` | `{...params, ...body, ...query}` |

> I route param (`req.params`) vengono **ri-applicati per ultimi** su `data`: a parità di chiave vincono sempre sul body/query. Gli upload multipart finiscono in `$files`; il body raw (se `parseRaw`) in `$raw`.

***REMOVED******REMOVED******REMOVED******REMOVED*** Mappatura errori → status HTTP

Il `name` dell'errore lanciato dal microservizio determina lo status: `BadRequestError`/`InvalidParamsErrror` → 400, `UnauthorizedError` → 401, `ForbiddenError` → 403, `NotFoundError` → 404, altrimenti → 500. In `mode: event` un confirm fallito → 503.

---

***REMOVED******REMOVED*** Gateway WebSocket

Il gateway WebSocket inoltra eventi del broker ai client connessi (o a webhook HTTP), con autenticazione, autorizzazione per evento e funzionamento corretto in **multi-istanza** (fan-out).

***REMOVED******REMOVED******REMOVED*** Configurazione

```yaml
gateway:
  ws:                                ***REMOVED*** solo livello connessione
    maxConnections: 5000             ***REMOVED*** limite connessioni per istanza
    maxSubscriptionsPerClient: 50    ***REMOVED*** limite sottoscrizioni per client
    heartbeatIntervalMs: 30000       ***REMOVED*** ping/pong per chiudere le connessioni morte
    allowedOrigins:                  ***REMOVED*** allowlist Origin dell'handshake (omessa → tutte)
      - https://app.example.com
    maxMessageBytes: 16384           ***REMOVED*** scarta i frame client più grandi (default 16KB)

  events:
    - name: orders
      type: ws                       ***REMOVED*** ws | http (webhook)
      exchange: orders-ex
      routingKey: orders.***REMOVED***
      auth: gateway-jwks             ***REMOVED*** provider che verifica il token e mappa i claim PER QUESTO evento
      requireAuth: true              ***REMOVED*** default true quando `auth` è impostato; false → auth opzionale
      roles: [orders.read]           ***REMOVED*** verifica ACL via IAclRoleService
      scopeClaim: X-GTW-AUTH-USERID  ***REMOVED*** inoltra solo i messaggi dell'utente...
      payloadKey: userId             ***REMOVED*** ...dove payload.userId === claim dell'utente

    - name: invoices                 ***REMOVED*** forwarding webhook
      type: http
      exchange: inv-ex
      routingKey: inv.***REMOVED***
      url: https://hooks.example.com/invoices
      method: POST
      timeout: 8000
```

***REMOVED******REMOVED******REMOVED*** Autenticazione (token nel subprotocol)

I browser non possono impostare header custom sull'handshake, quindi il token JWT viaggia nel **subprotocol** (`Sec-WebSocket-Protocol`):

```js
const ws = new WebSocket('ws://localhost:3000', [token]); // oppure ['bearer', token]
```

Il token viene conservato sulla connessione e **verificato al momento del `subscribe` con il provider dichiarato dall'evento** (`events[].auth`), che ne mappa anche i claim. La verifica è memoizzata per provider: lo stesso token è verificato al più una volta per provider. Eventi diversi possono usare provider diversi.

***REMOVED******REMOVED******REMOVED*** Protocollo client

```js
ws.send(JSON.stringify({ action: 'subscribe',   topic: 'orders', select: { status: 'open' } }));
ws.send(JSON.stringify({ action: 'unsubscribe', topic: 'orders' }));
// messaggi in arrivo: { topic: 'onOrders', data: <payload> }
// errori:            { topic: 'onError',  data: { event, error } }
```

***REMOVED******REMOVED******REMOVED*** Sicurezza e scalabilità

- **Auth per evento**: `events[].auth` indica il provider che verifica il token e mappa i claim per quell'evento; `requireAuth: false` rende l'auth opzionale (anonimi ammessi, claim mappati se il token c'è). Subscribe negato (`onError: unauthorized`) se l'auth è richiesta e il token non è valido.
- **Authz per evento**: `roles` (ACL via `IAclRoleService`) sull'identità ricavata da `auth`.
- **Scoping per-utente**: `scopeClaim` + `payloadKey` impediscono a un client di ricevere dati altrui tramite un `select` arbitrario (il filtro server-side è intersecato con quello del client, mai allargato). Se `scopeClaim` è impostato senza `payloadKey`, **nega tutto** (safe default).
- **Sessione limitata dalla scadenza del token**: l'`exp` del JWT viene catturato alla prima verifica e la connessione viene chiusa (`1008 token expired`) appena scade — niente consegne dopo la scadenza.
- **Origin allowlist**: `gateway.ws.allowedOrigins` rifiuta gli handshake cross-site (se omessa, tutte le origin sono accettate e lo si segnala a boot).
- **Multi-istanza**: ogni istanza crea una coda AMQP **effimera ed esclusiva** (nome unico per processo) → tutte le repliche ricevono ogni evento e lo inoltrano ai rispettivi client.
- **Hardening**: heartbeat ping/pong, limiti connessioni/sottoscrizioni, limite dimensione frame (`maxMessageBytes`), cleanup robusto su `close`/`error`.

---

***REMOVED******REMOVED*** Remote config

`RemoteConfigService` permette ai microservizi di **registrare le proprie route nel gateway a runtime**, pubblicando le loro `PathDefinition` su un exchange fanout `config.ms`. Il gateway le riceve e chiama `HttpHandlerService.registerPath()` dinamicamente. In alternativa, `gateway.loadConfig` carica paths/events tramite una singola chiamata RPC all'avvio.

---

***REMOVED******REMOVED*** Moduli opzionali `AclModule` e `GatewayAdminModule` (persistenza fornita dal consumer)

Due moduli **opzionali** per gestire ACL e configurazione gateway a database. **La lib non dipende da Mongo/Redis**: definisce i servizi/cache + i **contratti repository (classi astratte)** e l'interfaccia `AclCacheStore`; **il consumer fornisce le implementazioni** (es. Mongo + Redis). Esempio completo e funzionante: **[`apps/gateway-2`](apps/gateway-2)** — per restare autonomo usa **repository in-RAM** (`InMemory*Repository`) e una **cache L2 in-RAM** (`InMemoryAclStore`), così gira solo con RabbitMQ; in produzione si rimpiazzano con implementazioni Mongo/Redis senza toccare la lib.

***REMOVED******REMOVED******REMOVED*** `AclModule` — ACL DB-backed con cache 2-livelli

ACL (azioni → ruoli → grant per-utente) con `canUserDo` corretto e **cache RAM + L2 pluggable** (TTL diversi) e invalidazione che forza il DB.

```ts
import { AclModule, AclService, AclActionRepository, AclRoleRepository, AclGrantRepository,
         RLB_ACL_CACHE_STORE, RLB_GTW_ACL_ROLE_SERVICE } from '@open-rlb/nestjs-amqp';

@Module({
  imports: [
    BrokerModule.forRootAsync({ /* ... */ }),
    // ProxyModule riceve auth/gateway config e usa AclService come IAclRoleService (AclModule è @Global):
    ProxyModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        authOptions: config.get<HandlerAuthConfig[]>('auth-providers'),
        gatewayOptions: config.get<GatewayConfig>('gateway'),
      }),
      providers: [{ provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService }],
    }),
    AclModule.forRoot(
      [
        ...aclMongoModelProviders,                                   // provider dei model Mongoose
        { provide: AclActionRepository, useClass: MongoAclActionRepository },
        { provide: AclRoleRepository,   useClass: MongoAclRoleRepository },
        { provide: AclGrantRepository,  useClass: MongoAclGrantRepository },
        InMemoryAclStore,                                            // implementa AclCacheStore
        { provide: RLB_ACL_CACHE_STORE, useExisting: InMemoryAclStore },// L2 opzionale (omesso → solo RAM)
      ],
      { cache: { ramTtlMs: 30000, l2TtlSec: 600 } },
    ),
  ],
})
export class AppModule {}
```

- I handler sono esposti su `BrokerService` con topic **`rlb-acl`** (costante `ACL_TOPIC`): `acl-can-user-do` (rpc), `acl-grant`/`acl-revoke`, `acl-action-*`, `acl-role-*`. Definisci nel tuo `broker.topics` un topic `rlb-acl` e imposta negli auth-provider `aclTopic: rlb-acl`, `aclAction: acl-can-user-do`.
- `AclService.canUserDo(topic, action, userId)` serve dalla cache; sul miss interroga il DB (`checkActions`: i ruoli del grant devono coprire l'azione) e ripopola RAM+L2.
- **Invalidazione**: ogni mutazione (grant/role/action) svuota L1 e L2 → la prossima verifica pesca dal DB. Senza L2, la coerenza multi-istanza è limitata dal `ramTtlMs`.
- **Cache L2 pluggable**: il consumer fornisce `{ provide: RLB_ACL_CACHE_STORE, useClass/useExisting }` che implementa `AclCacheStore` (`get/set/del/keys`). In `gateway-2` è `InMemoryAclStore` (mock in RAM, nessuna dipendenza esterna); in produzione plugga uno store condiviso (es. Redis).

***REMOVED******REMOVED******REMOVED*** `GatewayAdminModule` — CRUD rotte/auth + liste + metriche

CRUD di rotte HTTP e auth-providers (repo forniti dal consumer), con **liste esportabili** per il gateway (in aggiunta allo YAML), **metriche a contatori** e **ordinamento path static-before-param**.

```ts
import { GatewayAdminModule, HttpPathRepository, AuthProviderRepository, HttpMetricRepository } from '@open-rlb/nestjs-amqp';

GatewayAdminModule.forRoot([
  ...gatewayAdminMongoModelProviders,
  { provide: HttpPathRepository,     useClass: MongoHttpPathRepository },
  { provide: AuthProviderRepository, useClass: MongoAuthProviderRepository },
  { provide: HttpMetricRepository,   useClass: MongoHttpMetricRepository },
]);
```

Handler su topic **`rlb-gateway-admin`** (`GATEWAY_ADMIN_TOPIC`):
- CRUD rotte: `gw-path-create/update/delete/get/list`; **`gw-path-export` (rpc)** → tutte le rotte abilitate come `PathDefinition[]` **ordinate** (statiche prima delle parametriche). Punta `gateway.loadConfig.paths` a `{ topic: rlb-gateway-admin, action: gw-path-export }`.
- CRUD auth: `gw-auth-create/.../list`; **`gw-auth-export` (rpc)** → `HandlerAuthConfig[]` abilitati (per frontend / merge lato gateway).
- Metriche: **`gw-metrics-track` (event)** incrementa i contatori per `(method, route)`; **`gw-metrics-get` (rpc)** restituisce count/errori/durata media per il frontend.

> **Ordinamento path**: `gw-path-export` usa `orderPaths()` così `resources/path` precede `resources/:varName` — necessario perché Express, registrando prima la rotta parametrica, intercetterebbe il segmento statico.

---

***REMOVED******REMOVED*** API `BrokerService`

| Metodo                                                       | Uso                                              |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `requestData(topic, action, payload?, headers?, timeout?)`   | RPC request/response (attende la risposta)       |
| `publishMessage(topic, action, payload, headers?)` → `Promise<boolean>` | event fire-and-forget con publisher confirm |
| `registerRpc(topic, handler)`                                | consumer RPC manuale                             |
| `registerHandler(topic, handler)`                            | consumer `handle` / `broadcast` (ritorna void)   |
| `getRpc(topic)` / `getHandler(topic)`                        | recupera l'handler registrato                    |
| `events$` / `getEvents$<T>()`                                | Observable degli eventi dei topic `toObservable` |

***REMOVED******REMOVED******REMOVED*** Decoratori

| Decoratore                                                    | Uso                                  |
| ------------------------------------------------------------- | ------------------------------------ |
| `@BrokerAction(topic, action, type?)`                         | lega un metodo a topic/action        |
| `@BrokerParam(source, name?)`                                 | mappa i parametri dai dati messaggio |
| `@BrokerAuth(authName, allowAnonymous?, roles?)`              | metadati di auth (usati dallo scanner) |
| `@BrokerHTTP(method, path, dataSource?, timeout?, parseRaw?)` | metadati HTTP (usati dallo scanner)  |

***REMOVED******REMOVED******REMOVED*** Pipe utility

`BooleanPipe` e `NumberPipe` convertono valori stringa/numerici (es. da query string). Esportate da `@open-rlb/nestjs-amqp`.

---

***REMOVED******REMOVED*** ⚠️ Gotcha e casi a rischio bug

Questi sono i punti che causano più frequentemente bug silenziosi. **Leggili prima di estendere la lib.**

***REMOVED******REMOVED******REMOVED*** Decoratori e handler

1. **Niente destructuring nei parametri dell'handler.** `@BrokerParam` associa i parametri leggendo il *source* della funzione con una regex (`getParamNames`). Una firma come `fn({ a, b })` rompe l'allineamento degli indici. Usa parametri semplici.
2. **Evita i valori di default nei parametri.** C'è uno strip basilare (`removeDefaultsFromParams`), ma default complessi (oggetti, chiamate) disallineano la mappatura. Passa sempre un `name` esplicito a `@BrokerParam`.
3. **`(topic, action)` deve essere unico.** Tutti gli `@BrokerAction` dello stesso topic condividono **una sola coda/consumer** e vengono smistati per `action`. Due metodi con lo stesso `(topic, action)` → il secondo sovrascrive il primo in silenzio.

***REMOVED******REMOVED******REMOVED*** Wiring topic ↔ queue ↔ exchange

4. **Il `name` del topic deve coincidere ovunque**: `@BrokerAction(topic)`, `topics[].name`, `requestData/publishMessage(topic)`, `gateway.paths[].topic`/`events[]`. Un typo → `Topic X not found in configuration`.
5. **`mode: rpc`/`handle` richiedono che `topics[].queue` esista in `broker.queues[]`**, e che il `queue.exchange` esista in `broker.exchanges[]`. In `handle` un queue mancante causa un NPE all'avvio (`queue.exchange`).
6. **Exchange `type: topic` → il queue DEVE avere `routingKey`**, altrimenti l'avvio lancia `Queue ... has no routing key`.
7. **`mode: broadcast` e gateway WebSocket richiedono `connection_name`** (`clientProperties.connection_name`), altrimenti throw.

***REMOVED******REMOVED******REMOVED*** RPC / timeout / errori

8. **Reply RPC**: `requestData` risolve `replyTo` da `broker.replyQueues[exchange]`; se assente usa la direct-reply-to di RabbitMQ. Un `replyQueues` con la chiave exchange sbagliata → nessuna risposta → timeout.
9. **Le eccezioni dell'handler RPC NON propagano come throw lato consumer**: vengono restituite come `{ success: false, error }` e `requestData` rilancia l'errore al chiamante. Sul gateway lo status dipende dal `error.name` (vedi tabella). Dai agli errori un `name` coerente.
10. **Timeout di default 10s** (o `broker.defaultRpcTimeout`). Per RPC lente imposta `timeout` sulla path o sull'argomento di `requestData`.

***REMOVED******REMOVED******REMOVED*** Gateway HTTP

11. **`parseRaw: true` richiede `NestFactory.create(AppModule, { rawBody: true })`**, altrimenti `$raw` è `undefined`.
12. **I route param vincono sul body/query** (ri-applicati per ultimi). Attento alle collisioni di chiave (`:id` vs `body.id`).
13. **Gli upload sono in `$files`** (multer `.any()`); i buffer vengono convertiti in stringa binaria — rigestiscili con cura lato consumer.

***REMOVED******REMOVED******REMOVED*** Auth / ACL

14. **`roles` su una path o evento richiede un `IAclRoleService`** registrato via `RLB_GTW_ACL_ROLE_SERVICE` in `ProxyModule.forRootAsync({ providers: [...] })`. L'auth-provider deve definire `aclTopic`, `aclAction`, `uidClaim`, `usernameClaim`, e `uidClaim` deve corrispondere a un `dest` del `jwtMap`. Mancante → throw. Nota: `authOptions`/`gatewayOptions` si passano a `ProxyModule`, non a `BrokerModule`.
15. **Gli header propagati sono uppercase e prefissati** (`${headerPrefix}${DEST}`): leggi `X-GTW-AUTH-USERID`, non `userId`.

***REMOVED******REMOVED******REMOVED*** WebSocket

16. **`scopeClaim` referenzia il claim MAPPATO** (con `headerPrefix`, es. `X-GTW-AUTH-USERID`), non il claim grezzo del token. `payloadKey` è la chiave nel payload dell'evento. Senza `payloadKey`, lo scope nega tutto.
17. **Non usare code durevoli condivise per gli eventi WS**: la lib crea una coda esclusiva per istanza apposta per il fan-out. Una coda fissa farebbe competere le istanze (i client di un'istanza perderebbero messaggi).

***REMOVED******REMOVED******REMOVED*** Publish / event

18. **`publishMessage` è `async`: devi fare `await`** per ottenere la garanzia di publisher confirm e per intercettare i fallimenti. Senza `await` è fire-and-forget senza garanzia.
19. **Gli handler `handle`/`broadcast` devono restituire `void`**: un valore di ritorno genera un warning (`Subscribe handlers should only return void`).

***REMOVED******REMOVED******REMOVED*** TLS / credenziali

20. **JWKS verifica il TLS di default.** Usa `httpsAllowUnauthorized: true` su un provider solo per issuer self-signed in sviluppo.
21. **`mechanism` credenziali**: `PLAIN` | `EXTERNAL` | `AMQPLAIN` (case-insensitive). Un valore sconosciuto non imposta la `response` → autenticazione fallita.

---

***REMOVED******REMOVED*** Errori comuni

- `Topic <name> not found in configuration`: controlla `topics[].name`, `@BrokerAction`, `requestData`/`publishMessage`, `gateway.paths[].topic`.
- `Queue <name> not found in configuration`: verifica che `topics[].queue` esista in `broker.queues[]`.
- `Queue <name> has no routing key`: l'exchange è di tipo `topic` ma il queue non ha `routingKey`.
- `Client name is required ...`: manca `connection_name` (richiesto da broadcast e WebSocket).
- `ACL Role Service not found`: stai usando `roles` senza aver registrato `RLB_GTW_ACL_ROLE_SERVICE`.
- `401/403` dal gateway: controlla `auth`, `auth-providers[]`, e l'ACL service quando usi `roles`.
- Timeout RPC: `replyQueues` errato, `action` non gestita da alcun servizio, o handler troppo lento (`timeout`).

---

***REMOVED******REMOVED*** Sviluppo

```bash
npm run build        ***REMOVED*** compila (tsc)
npm test             ***REMOVED*** jest
npm run start:dev    ***REMOVED*** nest start --watch (app gateway di esempio)
```

Licenza: MIT.
