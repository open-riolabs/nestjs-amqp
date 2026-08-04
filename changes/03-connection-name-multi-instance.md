# 03 — `connection_name` logico + deployment multi-istanza 🟠 Cambio di comportamento

**Riguarda:** Gateway **e** Microservizi che usano `broadcast`, WebSocket, reload o route-discovery.

## Cosa è cambiato

Prima ogni istanza doveva avere un `connection_name` **fisicamente distinto**: condividerlo faceva sì
che RabbitMQ trattasse le code per-istanza come un unico consumer group e facesse **round-robin** dei
messaggi broadcast/WS/reload (segnali persi, WS client che non ricevevano eventi).

Ora **`connection_name` è un nome LOGICO**: la libreria vi **appende automaticamente
`-<hostname>-<pid>`** per istanza (l'hostname è unico per container/pod; sotto Docker il pid è sempre 1).
Le repliche possono quindi **condividere la stessa config**.

## Modifica — YAML (gateway e MS)

**Prima** (workaround per-istanza, es. iniettato da env/deploy)

```yaml
broker:
  connectionManagerOptions:
    connectionOptions:
      clientProperties:
        connection_name: my-service-1   # DOVEVA essere distinto per istanza
```

**Dopo** (un nome logico condiviso da tutte le repliche)

```yaml
broker:
  connectionManagerOptions:
    connectionOptions:
      clientProperties:
        connection_name: my-service     # LOGICO — la lib aggiunge -<hostname>-<pid> per istanza
```

> Regola invariata: `broadcast` + WebSocket **richiedono** un `connection_name` (o
> `broker.routeDiscovery.serviceName`, che lo popola se assente), altrimenti errore al boot. Le code di
> broadcast auto-create sono `autoDelete`.

Puoi **rimuovere** qualsiasi logica di deploy che generava suffissi/indici univoci per `connection_name`.

## Altri punti per il multi-istanza (config, non codice)

Quando giri con più repliche, tieni presente anche:

- **Invalidazione ACL cross-istanza** — senza di essa, dopo un grant/revoke ogni *altra* istanza serve
  decisioni ACL stantie dalla RAM fino alla scadenza (`ramTtlMs`, default 30 s). Abilita
  `acl.invalidation.exchange` (fanout). Vedi [05](05-acl-module-options.md).
- **Scheduler lock** — i job di rollup metriche e retention devono girare su **una** sola istanza per
  tick: fornisci un `RLB_GW_SCHED_LOCK`. Vedi [06](06-gateway-admin-options.md).
- **RPC su direct-reply-to** — non condividere `replyQueues` con nome fisso tra istanze, rompe il
  routing delle reply.
- **Limiti per-istanza** — imposta `gateway.maxConcurrentRequests` e `gateway.ws.maxConnections`. Vedi
  [04](04-gateway-limits.md).

## Checklist

- [ ] `connection_name` impostato come nome **logico** unico per servizio (non più per istanza).
- [ ] Rimosso il workaround di deploy che rendeva `connection_name` univoco per replica.
- [ ] (multi-istanza) Abilitata l'invalidazione ACL, lo scheduler lock e i limiti per-istanza.
