# Migrazione `@open-rlb/nestjs-amqp` — da 2.0.8 a 2.1.1

Questa cartella descrive **cosa modificare nei progetti che usano la libreria** (gateway e
microservizi) per allinearsi alla release **2.1.1** partendo dalla **2.0.8**.

Ogni file copre un tema, con: cosa è cambiato, perché, e la modifica concreta (prima/dopo) con
l'indicazione se riguarda il **Gateway**, il **Microservizio (MS)** o **entrambi**.

## Indice

| # | File | Tema | Gateway | MS | Rottura |
|---|------|------|:-------:|:--:|:-------:|
| 01 | [01-acl-actions.md](01-acl-actions.md) | ACL: da `roles` a `actions` nel gate delle route/eventi | ✅ | ✅ | 🔴 **Breaking** |
| 02 | [02-retry-policy.md](02-retry-policy.md) | Retry bounded al posto del requeue infinito | ✅ | ✅ | 🟠 Cambio default |
| 03 | [03-connection-name-multi-instance.md](03-connection-name-multi-instance.md) | `connection_name` logico + multi-istanza | ✅ | ✅ | 🟠 Comportamento |
| 04 | [04-gateway-limits.md](04-gateway-limits.md) | Limiti di hardening del gateway (body, upload, concorrenza, WS backpressure) | ✅ | — | 🟢 Additivo |
| 05 | [05-acl-module-options.md](05-acl-module-options.md) | Nuove opzioni `AclModule` (timeout, invalidation, role-management/role-system, cache cap) | ✅ | ✅* | 🟢 Additivo |
| 06 | [06-gateway-admin-options.md](06-gateway-admin-options.md) | Nuove opzioni `GatewayAdminModule` (retention, rollup, scheduler-lock, health, auth-registry) | ✅ | — | 🟢 Additivo |
| 07 | [07-queues-metrics-topic.md](07-queues-metrics-topic.md) | Code con crescita limitata + topic metriche dedicato | ✅ | ✅ | 🟢 Raccomandato |

> \* Il modulo ACL vive nel processo che ospita l'ACL (di solito il gateway). Un MS lo usa solo se
> ospita esso stesso l'ACL.

## In breve — le due modifiche che *rompono*

1. **ACL `roles` → `actions`** ([01](01-acl-actions.md)). Nelle `gateway.paths[]`, `gateway.events[]`
   e nel decorator `@BrokerAuth`, il 3° parametro non è più una lista di **ruoli** ma di **azioni**.
   I controlli in-process `canUserDoGtw` / `canUserDo` sono collassati in `checkAction(userId, ctx, actions)`.
   Le action HTTP `acl-can-user-do`, `acl-can-user-do-gtw`, `acl-verify-access`, `acl-list-by-user`
   **non esistono più** (usare `acl-check-action`). `companyId` ora è **load-bearing** in autorizzazione.

2. **Retry policy bounded** ([02](02-retry-policy.md)). Il vecchio default (nack-requeue infinito su
   errore handler) è **rimosso**. Default built-in: **5 tentativi → drop**. Configurabile con
   `broker.retry` e `topics[].retry`. Un RPC esaurito risponde `RetryExhaustedError` → il gateway
   mappa a **HTTP 502**.

## Ordine consigliato di applicazione

1. Aggiornare la dipendenza `@open-rlb/nestjs-amqp` alla 2.1.1 (e rifare `npm run build` della lib se
   la si consuma da workspace).
2. **[01]** Rinominare `roles` → `actions` ovunque e verificare la semantica `companyId`/`resourceId`.
3. **[02]** Definire una `broker.retry` esplicita (con dead-letter) prima di andare in produzione.
4. **[03]** Rimuovere gli hack di `connection_name` per-istanza: ora basta un nome logico condiviso.
5. **[04]–[06]** (solo gateway) Aggiungere i nuovi limiti/opzioni di hardening dove serve.
6. **[07]** Mettere un tetto di crescita alle code e isolare le metriche.
