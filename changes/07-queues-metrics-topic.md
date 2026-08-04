# 07 — Code con crescita limitata + topic metriche dedicato 🟢 Raccomandato

**Riguarda:** Gateway **e** Microservizi (chiunque dichiari code di lavoro).

## Perché

Una coda di lavoro **illimitata** può far scattare gli allarmi di memoria/disco di RabbitMQ, che
**bloccano TUTTI i publisher** dell'intero broker. Con la nuova retry policy ([02](02-retry-policy.md))
i messaggi non fanno più hot-loop, ma le code vanno comunque limitate in crescita.

## Modifica 1 — limiti di crescita sulle code

Imposta `messageTtl` / `maxLength` (ed eventualmente `expires`) in `queues[].options`:

```yaml
broker:
  queues:
    - name: rlb-work
      exchange: rlb
      routingKey: rlb-work
      createQueueIfNotExists: true
      options:
        durable: true
        messageTtl: 3600000     # ms: i messaggi scadono dopo 1h
        maxLength: 100000       # numero massimo di messaggi in coda
        # expires: 1800000      # ms: TTL della coda quando inutilizzata
```

> ⚠️ **Cambiare le `options` di una coda ESISTENTE causa un loop `406 PRECONDITION_FAILED`.**
> Per applicarle: cancella prima la coda, oppure usa una **policy** lato broker (senza toccare la
> dichiarazione). Su code nuove nessun problema.

## Modifica 2 — topic metriche dedicato (gateway)

Sulla coda admin **condivisa**, un DB metriche lento affama gli RPC admin `gw-health` / `gw-reload`.
Metti `gw-metrics-track` su un topic **dedicato** `rlb-gateway-metrics` con la sua coda **limitata**, e
puntaci `gateway.metrics.topic`:

```yaml
broker:
  queues:
    - name: rlb-gateway-metrics
      exchange: rlb
      routingKey: rlb-gateway-metrics
      createQueueIfNotExists: true
      options: { durable: true, messageTtl: 3600000, maxLength: 500000 }

topics:
  - name: rlb-gateway-metrics
    mode: handle
    queue: rlb-gateway-metrics
    exchange: rlb
    routingKey: rlb-gateway-metrics

gateway:
  metrics:
    topic: rlb-gateway-metrics     # invece del topic admin condiviso
    action: gw-metrics-track
```

Lato consumer delle metriche, l'handler può essere marcato **opt-in**: con `@BrokerAction` il 4°
parametro `{ optional: true }` fa sì che il binding sia **saltato** (log a debug) se il topic non è
configurato, invece di dare errore al boot.

```ts
@BrokerAction('rlb-gateway-metrics', 'gw-metrics-track', 'event', { optional: true })
async trackMetric(/* ... */) {}
```

## Nota — dataSource combinati (già disponibili)

`@BrokerHTTP` e `dataSource` accettano anche le modalità combinate `body-query` e `query-body` (merge
di params+query+body con precedenza all'ultima sorgente nominata). Se avevi ancora down-map manuali
verso `body`/`query`, ora puoi usarle direttamente.

## Checklist

- [ ] Aggiunti `messageTtl`/`maxLength` alle code di lavoro (attenzione al 406 su code esistenti).
- [ ] (gateway) Isolato `gw-metrics-track` su `rlb-gateway-metrics` con coda dedicata e limitata.
- [ ] (consumer metriche) Handler marcato `{ optional: true }` se il topic è opzionale.
