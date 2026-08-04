# 04 — Limiti di hardening del gateway 🟢 Additivo

**Riguarda:** solo il **Gateway**.

Nuovi limiti opzionali su `gateway` per proteggere l'istanza da OOM e overload. Tutti hanno default
sicuri; li imposti dove il traffico reale lo richiede.

## Nuove chiavi in `gateway` (config.yaml)

```yaml
gateway:
  # ...

  # Tetto di richieste HTTP in-flight per istanza: oltre il cap, le nuove richieste ricevono
  # subito 503 (Retry-After: 1) invece di accumularsi. Omesso/0 = nessun cap.
  maxConcurrentRequests: 200

  # Dimensione massima del body NON-multipart (JSON/urlencoded/text/raw). '5mb' o numero di byte.
  # ⚠️ Va anche APPLICATO nel bootstrap (main.ts) — vedi sotto. Omesso = default framework (~100kb).
  maxBodyBytes: 5mb

  # Limiti upload multipart (bufferizzati in RAM e ~2-3x nella frame AMQP). 413 se superati.
  upload:
    maxFileSizeMb: 25    # default 25
    maxFiles: 10         # default 10

  ws:
    # ... limiti esistenti (maxConnections, maxMessageBytes, ecc.)
    # Backpressure in uscita (default 1 MiB): se il buffer di un client WS supera questo valore,
    # i suoi messaggi vengono DROPPATI finché non si svuota (client lento ma pong-responsive
    # non fa crescere la memoria del gateway senza limiti).
    maxBufferedBytes: 1048576
```

## Wiring obbligatorio per `maxBodyBytes` — `main.ts`

`maxBodyBytes` è l'unico che richiede codice: il body parser va **ri-registrato** con il limite letto
dalla config (gli altri limiti sono applicati internamente dalla libreria).

```ts
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { GatewayConfig } from '@open-rlb/nestjs-amqp';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // ...adapter WS, shutdown hooks, ecc.

  const gateway = app.get(ConfigService).get<GatewayConfig>('gateway');
  const limit = gateway?.maxBodyBytes;
  if (limit) {
    // Sovrascrive il default ~100kb; body oltre il limite → 413. rawBody resta funzionante.
    app.useBodyParser('json', { limit });
    app.useBodyParser('urlencoded', { extended: true, limit });
  }

  await app.listen(/* ... */);
}
```

> `maxConcurrentRequests`, `upload` e `ws.maxBufferedBytes` **non** richiedono codice: basta la config.

## Note

- Gli upload sono bufferizzati in RAM e re-incapsulati nella frame AMQP (~2-3x): tieni conto del
  `max_message_size` del broker quando alzi `upload.maxFileSizeMb`.
- Una sorgente `loadConfig.events` **giù al boot non fa più crashare** il gateway: degrada a soli
  eventi da YAML (quelli remoti mancano fino al riavvio).

## Checklist

- [ ] Impostato `maxConcurrentRequests` sulla capacità reale dell'istanza.
- [ ] Impostato `maxBodyBytes` **e** aggiunto il wiring del body parser in `main.ts`.
- [ ] Rivisti i limiti `upload` se il gateway riceve file.
- [ ] Impostato `ws.maxBufferedBytes` se ci sono client WS lenti.
