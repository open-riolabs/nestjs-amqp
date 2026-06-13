---
description: Configure @open-rlb/nestjs-amqp in a NestJS project — BrokerModule setup (forRoot/forRootAsync), topic definitions (rpc/handle/broadcast/event), queue/exchange declarations, retention policy, error behavior, reply queues, and channel prefetch. Use when setting up or modifying broker configuration.
argument-hint: "[what to configure: module|topics|queues|exchanges|retention]"
---

***REMOVED*** @open-rlb/nestjs-amqp — Configuration

Configura `@open-rlb/nestjs-amqp` per: `$ARGUMENTS`

---

***REMOVED******REMOVED*** SETUP DEL MODULO

***REMOVED******REMOVED******REMOVED*** `BrokerModule.forRoot` — configurazione statica

```typescript
import { BrokerModule } from '@open-rlb/nestjs-amqp';

@Module({
  imports: [
    BrokerModule.forRoot(
      brokerConfig,   // RabbitMQConfig (connessione, exchange, queue)
      topics,         // BrokerTopic[] (topic logici dell'applicazione)
      appOptions,     // AppConfig (opzionale)
    ),
    // Gateway only: auth-providers + gateway config vanno su ProxyModule, non BrokerModule.
    // ProxyModule.forRoot({ authOptions, gatewayOptions }, [/* providers, es. ACL role service */]),
  ],
})
export class AppModule {}
```

***REMOVED******REMOVED******REMOVED*** `BrokerModule.forRootAsync` — configurazione asincrona (raccomandato con ConfigService)

```typescript
BrokerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => ({
    options: {
      uri: config.get('AMQP_URI'),
      // ... resto di RabbitMQConfig
    },
    topics: [ /* BrokerTopic[] */ ],
    appOptions: { environment: config.get('NODE_ENV') },
  }),
})
```

---

***REMOVED******REMOVED*** `RabbitMQConfig` — configurazione connessione e infrastruttura

```typescript
interface RabbitMQConfig {
  // URI connessione — stringa o array per clustering
  uri: string | string[] | Options.Connect | Options.Connect[];
  // Esempio stringa:  'amqp://user:pass@localhost:5672/vhost'
  // Esempio oggetto:  { hostname: 'localhost', port: 5672, username: 'user', password: 'pass', vhost: '/' }

  exchanges?: RabbitMQExchangeConfig[];      // exchange da dichiarare all'avvio
  queues?: RabbitMQQueueConfig[];            // queue da dichiarare e bindare all'avvio
  prefetchCount?: number;                    // default 10 — messaggi per consumer senza ACK
  defaultRpcTimeout?: number;               // default 10000 ms
  defaultExchangeType?: string;             // default 'topic'
  defaultSubscribeErrorBehavior?: MessageHandlerErrorBehavior; // default 'REQUEUE'
  defaultRpcErrorHandler?: MessageErrorHandler;               // handler errori custom globale
  enableDirectReplyTo?: boolean;            // default true — abilita amq.rabbitmq.reply-to
  replyQueues?: Record<string, string>;     // { [exchangeName]: queueName } per reply RPC custom
  channels?: Record<string, RabbitMQChannelConfig>; // canali named con prefetch dedicato
  connectionInitOptions?: ConnectionInitOptions;
  connectionManagerOptions?: AmqpConnectionManagerOptions;
  deserializer?: (message: Buffer, msg: ConsumeMessage) => any; // default JSON.parse
  serializer?: (value: any) => Buffer;                          // default JSON.stringify
}
```

***REMOVED******REMOVED******REMOVED*** Esempio completo `RabbitMQConfig`

```typescript
const brokerConfig: RabbitMQConfig = {
  uri: process.env.AMQP_URI,
  prefetchCount: 10,
  defaultRpcTimeout: 8000,
  defaultSubscribeErrorBehavior: MessageHandlerErrorBehavior.REQUEUE,
  enableDirectReplyTo: true,

  exchanges: [
    { name: 'app-ex',   type: 'topic',  options: { durable: true } },
    { name: 'dlx-ex',   type: 'fanout', options: { durable: true } },
    { name: 'reply-ex', type: 'direct', options: { durable: false } },
  ],

  queues: [
    {
      name: 'users-rpc-q',
      exchange: 'app-ex',
      routingKey: 'users.rpc',
      options: {
        durable: true,
        messageTtl: 30000,          // messaggi scadono dopo 30s
        deadLetterExchange: 'dlx-ex',
      },
    },
    {
      name: 'events-q',
      exchange: 'app-ex',
      routingKey: 'events.***REMOVED***',
      options: { durable: true, maxLength: 50000 },
    },
  ],

  replyQueues: {
    'app-ex': 'reply-q', // risposte RPC su questo exchange tornano su reply-q
  },

  channels: {
    'slow-channel': { prefetchCount: 2 },
  },

  connectionInitOptions: {
    wait: true,
    timeout: 10000,
    reject: true,
  },
};
```

---

***REMOVED******REMOVED*** Exchange — `RabbitMQExchangeConfig`

```typescript
interface RabbitMQExchangeConfig {
  name: string;
  type?: 'topic' | 'direct' | 'fanout' | 'headers'; // default: 'topic'
  options?: {
    durable?: boolean;    // default true — sopravvive ai restart del broker
    autoDelete?: boolean; // elimina se non ci sono binding
    internal?: boolean;   // solo per exchange-to-exchange binding
  };
  createExchangeIfNotExists?: boolean; // default true — se false usa checkExchange
}
```

| Tipo | Uso |
|---|---|
| `topic` | Routing per pattern (`users.rpc`, `events.***REMOVED***`, `orders.*`) |
| `direct` | Routing per chiave esatta — ideale per RPC reply |
| `fanout` | Broadcast a tutti i binding — ignora routing key |
| `headers` | Routing per header AMQP (raro) |

---

***REMOVED******REMOVED*** Queue — `RabbitMQQueueConfig`

```typescript
interface RabbitMQQueueConfig {
  name: string;
  exchange?: string;              // exchange a cui bindare
  routingKey?: string | string[]; // routing key/pattern (può essere array)
  options?: {
    // Durabilità
    durable?: boolean;            // default: true
    exclusive?: boolean;          // solo questo consumer, eliminata alla chiusura
    autoDelete?: boolean;         // eliminata quando l'ultimo consumer si disconnette

    // Retention policy
    messageTtl?: number;          // TTL messaggi in ms — scaduti → DLX o drop
    expires?: number;             // TTL della queue in ms — eliminata se inattiva
    maxLength?: number;           // max messaggi — i più vecchi vengono eliminati
    maxPriority?: number;         // abilita priority queue (1–255)

    // Dead Letter
    deadLetterExchange?: string;  // exchange destinazione messaggi scaduti/nacked
    deadLetterRoutingKey?: string; // routing key per il DLX (default: routing key originale)

    // Argomenti aggiuntivi AMQP
    arguments?: Record<string, any>;
  };
  bindQueueArguments?: Record<string, any>; // argomenti per il binding (es. headers exchange)
  consumerTag?: string;           // consumer tag fisso (deve essere unico per channel)
}
```

***REMOVED******REMOVED******REMOVED*** Retention policy — combinazioni comuni

```typescript
// Messaggio scade e va in dead-letter dopo 60s
options: {
  durable: true,
  messageTtl: 60000,
  deadLetterExchange: 'dlx-ex',
}

// Queue con limite messaggi — scarta i più vecchi quando piena
options: {
  durable: true,
  maxLength: 10000,
  deadLetterExchange: 'dlx-ex', // i messaggi scartati per overflow vanno nel DLX
}

// Queue temporanea per broadcast — si auto-elimina se inattiva per 1 ora
options: {
  durable: false,
  exclusive: false,
  autoDelete: true,
  expires: 3600000,
}
```

---

***REMOVED******REMOVED*** `BrokerTopic` — topic logici dell'applicazione

I topic sono l'astrazione di alto livello sopra exchange e queue. Ogni topic ha un **mode** che definisce il pattern di comunicazione.

```typescript
interface BrokerTopic {
  name: string;                 // identificatore univoco usato in registerRpc/registerHandler/publishMessage
  mode: 'rpc' | 'handle' | 'broadcast' | 'event';
  queue?: string;               // nome della queue dichiarata in RabbitMQConfig.queues
  exchange?: string;            // nome dell'exchange (alternativa alla queue per RPC/event)
  routingKey?: string;          // routing key (obbligatoria se exchange type è 'topic')
  toObservable?: boolean;       // default false — se true, i messaggi vanno su broker.events$
  errorBehavior?: MessageHandlerErrorBehavior; // comportamento NAK su errore (path decorativo)
}
```

***REMOVED******REMOVED******REMOVED*** Mode — quando usare quale

| Mode | Pattern | Risposta | Consumer |
|---|---|---|---|
| `rpc` | Request/Response sincrono | Sì | Uno (load balanced) |
| `handle` | Worker queue — un consumer processa il messaggio | No | Uno (load balanced) |
| `broadcast` | Pubsub — tutti i consumer attivi ricevono | No | Tutti |
| `event` | Fire-and-forget — solo publish, nessun consumer | No | Nessuno |

***REMOVED******REMOVED******REMOVED*** Esempio topic completi

```typescript
const topics: BrokerTopic[] = [
  // RPC tramite queue nominata (configurata in queues[])
  {
    name: 'users',
    mode: 'rpc',
    queue: 'users-rpc-q',     // deve esistere in RabbitMQConfig.queues
  },

  // RPC tramite exchange (senza queue nominata)
  {
    name: 'products',
    mode: 'rpc',
    exchange: 'app-ex',
    routingKey: 'products.rpc',
  },

  // Worker queue — un solo consumer processa ogni messaggio
  {
    name: 'order-processing',
    mode: 'handle',
    queue: 'orders-q',
    errorBehavior: MessageHandlerErrorBehavior.NACK, // dead-letter su errore
  },

  // Broadcast — tutti i consumer attivi ricevono una copia
  {
    name: 'config-updates',
    mode: 'broadcast',
    exchange: 'config-ex',
    routingKey: 'config.updated',
    // Nota: il BrokerService crea automaticamente una queue per-instance
    // con nome '{topic.name}-{connectionName}'
  },

  // Fire-and-forget — solo publishing
  {
    name: 'audit-log',
    mode: 'event',
    exchange: 'app-ex',
    routingKey: 'audit.log',
  },

  // Handle con observable — i messaggi finiscono su broker.events$
  {
    name: 'notifications',
    mode: 'handle',
    queue: 'notifications-q',
    toObservable: true,
  },
];
```

---

***REMOVED******REMOVED*** `ConnectionInitOptions`

```typescript
interface ConnectionInitOptions {
  wait?: boolean;    // default true — blocca finché la connessione è stabilita
  timeout?: number;  // default 5000 ms — tempo massimo di attesa
  reject?: boolean;  // default true — lancia errore se il timeout scade
  skipConnectionFailedLogging?: boolean;  // default false
  skipDisconnectFailedLogging?: boolean;  // default false
}
```

---

***REMOVED******REMOVED*** `MessageHandlerErrorBehavior`

```typescript
enum MessageHandlerErrorBehavior {
  ACK    = 'ACK',     // ACK il messaggio — scartato anche in caso di errore
  NACK   = 'NACK',    // NACK senza requeue → dead-letter exchange (se configurato)
  REQUEUE = 'REQUEUE' // NACK con requeue → il messaggio torna in coda (default)
}
```

Configurabile a tre livelli (in ordine di priorità):
1. **Per-topic**: `BrokerTopic.errorBehavior` (solo path decorativo `@BrokerAction`)
2. **Handler custom**: `MessageHandlerOptions.errorHandler` (funzione personalizzata)
3. **Globale**: `RabbitMQConfig.defaultSubscribeErrorBehavior`

---

***REMOVED******REMOVED*** Canali named — `RabbitMQChannelConfig`

Usa i canali named per dare prefetch diverso a consumer con velocità differenti:

```typescript
channels: {
  'fast': { prefetchCount: 20, default: false },
  'slow': { prefetchCount: 1,  default: false },
}
```

Poi nella definizione della queue:
```typescript
{
  name: 'heavy-processing-q',
  options: { channel: 'slow' }, // usa il canale lento
}
```

---

***REMOVED******REMOVED*** REGOLE DI CONFIGURAZIONE

Quando generi o modifichi la configurazione basandoti su `$ARGUMENTS`:

1. **Ogni topic deve avere almeno** `queue` OPPURE (`exchange` + `routingKey`).
   - Eccezione: mode `rpc` accetta solo `exchange` + `routingKey` (nessuna queue nominata).
   - Mode `broadcast` richiede sempre `exchange` + `routingKey`.

2. **Le queue referenziate nei topic** devono essere dichiarate in `RabbitMQConfig.queues`.

3. **Gli exchange referenziati** devono essere dichiarati in `RabbitMQConfig.exchanges`.

4. Per RPC con risposta attesa: configura `replyQueues` se non usi `amq.rabbitmq.reply-to`.

5. Per retention: `messageTtl` agisce sui singoli messaggi, `expires` sulla queue stessa.
   Combinali con `deadLetterExchange` per non perdere i messaggi scaduti.

6. Per broadcast: il `BrokerService` crea automaticamente una queue con nome
   `{topic.name}-{connectionName}`. Il `connectionName` viene da
   `connectionManagerOptions.connectionOptions.clientProperties.connection_name`.
   Questo campo è **obbligatorio** per i topic broadcast.

7. `prefetchCount: 1` garantisce strict ordering e fair dispatch tra consumer.
   Aumentalo (10–50) per throughput su operazioni veloci.
