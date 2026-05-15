---
description: Generate NestJS code using @open-rlb/nestjs-amqp — decorators (@BrokerAction, @BrokerParam), subscription handlers (registerRpc, registerHandler), RPC calls, and event publishing. Use when adding new message handlers or consumers to a project.
argument-hint: "[topic] [action] [mode: rpc|handle|broadcast|event]"
---

***REMOVED*** @open-rlb/nestjs-amqp — Code Generation

Generate code for the `@open-rlb/nestjs-amqp` library based on: `$ARGUMENTS`

---

***REMOVED******REMOVED*** DECORATOR PATH — `@BrokerAction`

Use this path when the handler is part of a NestJS service that should be auto-discovered at startup. The `MetadataScannerService` scans all providers for decorated methods and registers one AMQP subscription per **topic** (not per action).

***REMOVED******REMOVED******REMOVED*** Signatures

```typescript
// Method decorator — binds a method to a topic+action combination
@BrokerAction(topic: string, action: string, type?: 'rpc' | 'event')

// Parameter decorator — extracts values from the incoming message
@BrokerParam(source: BrokerParamSource, name?: string, pipe?: PipeTransform)
// source options:
//   'body'      → payload[name]          (default if no decorator on param)
//   'body-full' → entire payload object
//   'header'    → headers[name]
//   'tag'       → AMQP consumer tag
//   'action'    → message action string
//   'topic'     → topic name string
```

***REMOVED******REMOVED******REMOVED*** Example — RPC handler

```typescript
import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class UsersService {

  @BrokerAction('users', 'getUser')
  async getUser(
    @BrokerParam('body', 'userId') userId: string,
    @BrokerParam('header', 'X-Tenant-ID') tenantId: string,
  ): Promise<UserDto> {
    return this.usersRepository.findOne(userId, tenantId);
  }

  @BrokerAction('users', 'createUser')
  async createUser(
    @BrokerParam('body-full') body: CreateUserDto,
    @BrokerParam('header', 'X-Request-ID') requestId: string,
  ): Promise<UserDto> {
    return this.usersRepository.create(body);
  }
}
```

***REMOVED******REMOVED******REMOVED*** Example — Nack esplicito da handler decorato

```typescript
import { Nack } from '@open-rlb/nestjs-amqp';

@BrokerAction('orders', 'processOrder')
async processOrder(@BrokerParam('body-full') order: OrderDto) {
  if (!this.isValid(order)) {
    return new Nack(false); // false = dead-letter, non reinserire
  }
  if (!this.canProcess()) {
    return new Nack(true);  // true = requeue
  }
  await this.process(order);
  // ritorno void/undefined → messaggio ACKato
}
```

***REMOVED******REMOVED******REMOVED*** Valori di ritorno dagli handler decorati

| Valore | Effetto |
|---|---|
| Qualsiasi valore / `undefined` / `void` | ACK + valore inviato come risposta RPC |
| `new Nack(false)` | NACK senza requeue (dead-letter o drop) |
| `new Nack(true)` | NACK con requeue |
| `Promise<T>` | Atteso, poi stesse regole |
| `Observable<T>` | `lastValueFrom`, poi stesse regole |

***REMOVED******REMOVED******REMOVED*** Vincoli critici

- Tutti i metodi decorati con `@BrokerAction` sullo **stesso topic** condividono **una sola subscription AMQP**.
  Il dispatcher instrada i messaggi per `msg.action` al metodo corretto.
- Se `msg.action` non corrisponde ad alcun metodo → `Nack(false)` (dead-lettered).
- Il servizio **deve** essere un provider NestJS registrato in un modulo (`@Injectable()`).
- L'estrazione dei parametri è posizionale: l'ordine dei parametri deve corrispondere all'ordine dei decoratori.
- Se `@BrokerParam` è omesso su un parametro, la source default è `'body'` con il nome del parametro come chiave.

---

***REMOVED******REMOVED*** MANUAL PATH — `registerRpc` e `registerHandler`

Usa questo path in `onModuleInit` quando la logica di sottoscrizione è dinamica o condizionale.

***REMOVED******REMOVED******REMOVED*** `BrokerService.registerRpc` — sottoscrittore RPC

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { BrokerService, BrokerEvent } from '@open-rlb/nestjs-amqp';

@Injectable()
export class OrdersConsumerService implements OnModuleInit {

  constructor(private readonly broker: BrokerService) {}

  async onModuleInit() {
    await this.broker.registerRpc<CreateOrderRequest, CreateOrderResponse>(
      'orders', // nome topic — deve esistere nella config topics di BrokerModule
      async (event: BrokerEvent<CreateOrderRequest>) => {
        const { payload, action, headers, source } = event;
        // l'handler DEVE restituire la risposta — viene inviata al chiamante
        return { orderId: await this.createOrder(payload) };
      }
    );
  }
}
```

***REMOVED******REMOVED******REMOVED*** `BrokerService.registerHandler` — handler di sottoscrizione (nessuna risposta)

```typescript
async onModuleInit() {
  await this.broker.registerHandler<UserCreatedEvent>(
    'user-events', // topic name — mode deve essere 'handle' o 'broadcast'
    async (event: BrokerEvent<UserCreatedEvent>) => {
      await this.sendWelcomeEmail(event.payload);
      // ritorno void → ACK
      // return new Nack(true) → requeue
    }
  );
}
```

***REMOVED******REMOVED******REMOVED*** `registerHandler` con Observable stream

Se il topic ha `toObservable: true` nella config, ometti l'handler:

```typescript
async onModuleInit() {
  await this.broker.registerHandler('notifications');
  // i messaggi vengono pushati su broker.events$
}

// Altrove, sottoscrivi l'observable
this.broker.getEvents$<NotificationPayload>().subscribe(event => {
  this.process(event.payload);
});
```

***REMOVED******REMOVED******REMOVED*** Forma di `BrokerEvent<T>`

```typescript
interface BrokerEvent<Payload = any> {
  topic: string;
  payload: Payload;
  action: string;
  source: {
    exchange: string;
    routingKey: string;
    tag: string;        // AMQP consumer tag
  };
  headers: Record<string, any>;
  raw: Buffer;          // contenuto grezzo del messaggio
}
```

***REMOVED******REMOVED******REMOVED*** Gestione errori negli handler manuali

```typescript
async (event: BrokerEvent<T>) => {
  try {
    await this.process(event.payload);
    // nessun return → ACK
  } catch (err) {
    // Errore transitorio → requeue
    return new Nack(true);
    // Payload permanentemente invalido → dead-letter
    return new Nack(false);
    // Oppure rilancia → il connection errorBehavior decide (default: REQUEUE)
    throw err;
  }
}
```

---

***REMOVED******REMOVED*** PUBLISHING — `requestData` e `publishMessage`

***REMOVED******REMOVED******REMOVED*** Chiamata RPC — `requestData`

```typescript
// Restituisce il payload della risposta oppure lancia su timeout/errore
const result = await this.broker.requestData<RequestType, ResponseType>(
  'users',             // topic name
  'getUser',           // action
  { userId: '123' },   // payload
  { 'X-Tenant-ID': tenantId }, // headers (opzionale)
  5000,                // timeout ms (opzionale, default: 10000)
);

if (!result) throw new NotFoundException();
```

***REMOVED******REMOVED******REMOVED*** Pubblicazione evento — `publishMessage`

```typescript
// Fire-and-forget, nessuna risposta
this.broker.publishMessage(
  'user-events',       // topic name (mode deve essere 'event' o 'broadcast')
  'userCreated',       // action
  { userId, email },   // payload
  { 'X-Source': 'auth-service' }, // headers (opzionale)
);
```

---

***REMOVED******REMOVED*** PIPES in `@BrokerParam`

```typescript
import { NumberPipe, BooleanPipe } from '@open-rlb/nestjs-amqp';

@BrokerAction('products', 'list')
async listProducts(
  @BrokerParam('body', 'page', new NumberPipe()) page: number,
  @BrokerParam('body', 'active', new BooleanPipe()) active: boolean,
) { ... }
```

Pipe built-in: `NumberPipe`, `BooleanPipe`. Qualsiasi `PipeTransform` NestJS è accettato.

---

***REMOVED******REMOVED*** REGOLE DI GENERAZIONE

Quando generi codice basato su `$ARGUMENTS`:

1. **Determina il mode** dal topic config (rpc / handle / broadcast / event):
   - `rpc` → `@BrokerAction` o `registerRpc`, restituire sempre una risposta
   - `handle` / `broadcast` → `@BrokerAction` o `registerHandler`, ritorno void o Nack
   - `event` → solo `publishMessage` (nessun consumer)

2. Usa il **decorator path** se il servizio è già un `@Injectable()` NestJS.
   Usa il **manual path** se la registrazione è dinamica o condizionale.

3. Aggiungi sempre `implements OnModuleInit` per la registrazione manuale.

4. Usa `BrokerEvent<PayloadType>` come tipo del parametro handler.

5. Non chiamare `registerRpc` o `registerHandler` più di una volta per lo stesso topic nella stessa istanza del servizio.

6. Per handler RPC: errori transitori → `throw err` (requeue per default). Payload permanentemente invalido → `return new Nack(false)`.
