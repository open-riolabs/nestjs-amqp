# 05 — Nuove opzioni `AclModule` 🟢 Additivo

**Riguarda:** il processo che ospita l'ACL (di norma il **Gateway**; un MS solo se ospita l'ACL).

`AclModuleOptions` guadagna diverse opzioni per hardening sotto carico, multi-istanza e gestione ruoli.
Tutte hanno default; le imposti dove serve.

## Firma

```ts
AclModule.forRoot(providers: Provider[], options?: AclModuleOptions)
```

## `AclModuleOptions` — campi nuovi/rilevanti

```ts
AclModule.forRoot(
  [
    { provide: AclActionRepository, useExisting: MongoAclActionRepository },
    { provide: AclRoleRepository, useExisting: MongoAclRoleRepository },
    { provide: AclGrantRepository, useExisting: MongoAclGrantRepository },
    { provide: RLB_ACL_CACHE_STORE, useExisting: MyL2Store },
  ],
  {
    cache: {
      ramTtlMs: 30000,        // TTL L1 (RAM) in ms (default 30000)
      l2TtlSec: 600,          // TTL L2 (store) in secondi (default 600)
      maxRamEntries: 50000,   // NUOVO: cap duro sulle entry L1; oltre → evict del più vecchio.
                              //        0/negativo = illimitato (sconsigliato). Default 50000.
    },

    // NUOVO: deadline (ms) sulla risoluzione DB in un checkAction con cache-miss (letture ruoli+grant).
    // Allo scadere il check FALLISCE (throw) → il gateway va in fail-closed 503 invece di bloccarsi
    // su un DB ACL in stallo (head-of-line blocking). Default 5000. 0/negativo = nessun limite (vecchio
    // comportamento). I cache HIT non sono mai toccati.
    checkTimeoutMs: 5000,

    // NUOVO: invalidazione L1 cross-istanza su AMQP. Su grant/revoke/modifiche a ruoli/azioni,
    // l'istanza che muta fa broadcast: le altre svuotano subito la RAM (invece di aspettare ramTtlMs).
    // L'exchange DEVE essere dichiarato in broker.exchanges (tipicamente un fanout). Omesso = no-op.
    invalidation: { exchange: 'rlb-acl-invalidate', routingKey: 'acl-invalidate' },

    // NUOVO: azione richiesta al chiamante (sul target company/resource) per grant/revoke.
    // Default 'role-management'.
    roleManagementAction: 'role-management',

    // NUOVO: azione di override SYSTEM, verificata resource-AGNOSTIC. Chi la possiede può grant/revoke
    // su QUALSIASI risorsa (bypassa il check per-risorsa). Utile per il bootstrap del primo owner.
    // Default 'role-system'. Concedila solo ad admin di sistema fidati.
    roleSystemAction: 'role-system',
  },
)
```

Se usi l'`invalidation`, dichiara l'exchange fanout nel broker:

```yaml
broker:
  exchanges:
    - name: rlb-acl-invalidate
      type: fanout
      createExchangeIfNotExists: true
      options: { durable: true }
```

## Bootstrap dei ruoli (chicken-and-egg)

Con grant/revoke **gated** (vedi [01](01-acl-actions.md)), nessun chiamante può concedere il **primo**
`role-management`/`role-system`. Quindi:

1. **Semina a mano nel DB** la prima grant `role-system` (o `role-management`) per un utente/servizio
   amministrativo.
2. Da lì in poi, quell'utente può concedere `role-management` ai proprietari delle singole risorse.
3. La logica di gate è in `AclManagementService.assertCanManage` (prima il check per-risorsa
   `role-management`, poi il bypass `role-system`).

## Nuovi export utili

Dal package sono ora esportati anche `AclInvalidationService` e gli helper di `auth-match`.

## Checklist

- [ ] Passata la seconda arg `options` a `AclModule.forRoot` con `cache.maxRamEntries`.
- [ ] Impostato `checkTimeoutMs` (o `0` se il DB ACL può legittimamente superare 5 s).
- [ ] (multi-istanza) Abilitata `invalidation` + dichiarato l'exchange fanout in `broker.exchanges`.
- [ ] Seminata nel DB la prima grant `role-system`/`role-management` per l'admin di bootstrap.
