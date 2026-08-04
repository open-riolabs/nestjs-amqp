# 06 — Nuove opzioni `GatewayAdminModule` 🟢 Additivo

**Riguarda:** solo il **Gateway** (che ospita `GatewayAdminModule`).

Nuove opzioni per retention delle metriche/journal, rollup orari, cap anti-OOM sulle query, scheduler
lock multi-istanza, health e registro auth-provider a runtime.

## Firma (invariata, con 2ª arg opzionale)

```ts
GatewayAdminModule.forRoot(providers: Provider[], options?: GatewayAdminModuleOptions)
// oppure forRootAsync({ imports, inject, useFactory, providers })
```

## `GatewayAdminModuleOptions` — campi

```ts
GatewayAdminModule.forRoot(
  [
    { provide: HttpPathRepository, useExisting: MongoHttpPathRepository },
    { provide: AuthProviderRepository, useExisting: MongoAuthProviderRepository },
    { provide: HttpMetricRepository, useExisting: MongoHttpMetricRepository },
    { provide: RouteSyncLogRepository, useExisting: MongoRouteSyncLogRepository },
    // NUOVO (multi-istanza): lock distribuito per rollup+retention → gira su UNA istanza per tick.
    MySchedulerLock,
    { provide: RLB_GW_SCHED_LOCK, useExisting: MySchedulerLock },
  ],
  {
    topic: 'rlb-gateway-admin',        // topic dei handler admin (default)

    // Route auto-discovery lato CONSUMER (il gateway riceve i manifest dei MS).
    // Devono combaciare con broker.routeDiscovery dei publisher. Default: rlb-route-discovery / rlb-route-sync.
    routeDiscovery: { exchange: 'rlb-route-discovery', queue: 'rlb-route-sync' },

    // NUOVO: retention (GIORNI) del journal route E dei punti metrici RAW. Righe più vecchie potate
    // ogni giorno. Default 90; 0/negativo = niente pruning.
    retentionDays: 90,

    // NUOVO: retention (GIORNI) dei ROLLUP metrici (aggregati orari downsamplati che sopravvivono ai
    // punti raw). Default 365. >0 attiva il job di rollup orario; 0/negativo = niente rollup.
    rollupRetentionDays: 365,

    // NUOVO: cap sui punti raw caricati in RAM da una query series/summary prima dell'aggregazione
    // (i percentili richiedono l'intero set). Protegge da OOM su finestre from/to larghe. Default 500000;
    // al raggiungimento usa gli ultimi N e logga un warning. 0/negativo = illimitato (sconsigliato).
    metricsQueryMaxPoints: 500000,
  },
)
```

## Scheduler lock (multi-istanza)

Rollup orario e retention giornaliera devono girare su **una** istanza per tick. Fornisci un
`RLB_GW_SCHED_LOCK`: usa un lock backed da Redis/Mongo per renderlo effettivo tra processi (una
`InMemorySchedulerLock` funziona solo single-process). Il rollup, oltre all'intervallo orario, fa
**catch-up al boot** delle ultime 3 ore completate (sotto lock), così gira anche su istanze di vita
breve.

## Registro auth-provider a runtime (opzionale)

Nuovo token `RLB_GTW_AUTH_PROVIDER_SOURCE`: registra una sorgente DB di auth-provider che il registro
runtime attiva su un `gw-auth-reload` deliberato (i provider DB si sovrappongono alla lista statica in
`auth-providers`).

```ts
ProxyModule.forRootAsync({
  // ...
  providers: [
    { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService },
    { provide: RLB_GTW_AUTH_PROVIDER_SOURCE, useExisting: MongoAuthProviderRepository }, // NUOVO
  ],
})
```

## Metriche: hook in-proxy vs store batch

Il sample gateway-db è passato dall'hook in-proxy (`RLB_GTW_METRICS_HOOK`) alla scrittura **batch** dei
punti via evento broker `gw-metrics-track` (un `InfluxPointStore` che consuma l'evento): così un
fallimento delle metriche **non tocca il path della richiesta**. L'hook `RLB_GTW_METRICS_HOOK` resta
disponibile ma non è più la via consigliata per il persist su TSDB.

## Health

Nuovo `GatewayHealthService` / action `gw-health`: `/health` resta una **liveness** minima
(`{ status: 'ok' }`), non un dump di metriche — usa `/admin/metrics*` per quelle.

## Nuovi export utili

`GatewayHealthService`, `GatewayMetricsRollupService`, `GatewayRetentionService`, `scheduler-lock`,
`health`, e gli util `metrics`.

## Checklist

- [ ] Passata la 2ª arg `options` con `retentionDays` / `rollupRetentionDays` / `metricsQueryMaxPoints`.
- [ ] (multi-istanza) Registrato un `RLB_GW_SCHED_LOCK` backed da Redis/Mongo.
- [ ] (opzionale) Registrato `RLB_GTW_AUTH_PROVIDER_SOURCE` se usi auth-provider da DB.
- [ ] Verificato che `routeDiscovery` combaci con `broker.routeDiscovery` dei MS.
