# 01 — ACL: da `roles` a `actions` nel gate 🔴 BREAKING

**Riguarda:** Gateway **e** Microservizi (chiunque usi `@BrokerAuth`, `gateway.paths[].roles`,
`gateway.events[].roles`, o chiami le action ACL).

## Cosa è cambiato

Il gate di autorizzazione del gateway (e il decorator `@BrokerAuth`) non ragiona più per **ruoli**
ma per **azioni**. Le grant continuano ad assegnare **ruoli** (i ruoli *contengono* azioni): è
cambiato solo **il gate**, che ora nomina azioni.

I due controlli in-process precedenti sono stati unificati:

| Prima (2.0.8) | Dopo (2.1.1) |
|---|---|
| `canUserDoGtw(roles, userId)` (resource-agnostic) | `checkAction(userId, ctx, actions)` |
| `canUserDo(roles, userId, resource)` (resource-scoped) | `checkAction(userId, { companyId, resourceId }, actions)` |

`checkAction` risolve `action → ruoli che la contengono`, poi verifica le grant dell'utente.
Una grant autorizza **solo se** `grant.companyId === req.companyId && grant.resourceId === req.resourceId`
(assente = `undefined`/`null`/`''`). **Niente wildcard**: un `resourceId` null **non** matcha tutto,
e `companyId` è load-bearing. L'unica eccezione: entrambi gli id assenti sia nella richiesta sia nella grant.

## Modifica 1 — YAML del gateway: `roles` → `actions`

**Prima**

```yaml
gateway:
  paths:
    - name: report-download
      method: GET
      path: /reports/:id
      auth: gateway-jwks
      roles: [user, admin]          # ruoli
  events:
    - name: chat
      auth: gateway-jwks
      roles: [user]                 # ruoli
```

**Dopo**

```yaml
gateway:
  paths:
    - name: report-download
      method: GET
      path: /reports/:id
      auth: gateway-jwks
      actions: [doc.read, doc.admin]   # AZIONI (OR); verificate su (companyId, resourceId) della richiesta
  events:
    - name: chat
      auth: gateway-jwks
      actions: [chat.read]             # AZIONI (OR); gli eventi WS gatano resource-agnostic
```

Regole invariate: `actions` richiede `auth` sullo stesso path/evento (senza identità → fail-closed,
ogni richiesta `403`). `actions` senza `auth` fallisce chiuso.

Il gateway estrae `companyId`/`resourceId` dalla richiesta con precedenza **params → query → body**
e li confronta **in modo esatto**. Assicurati che le route protette espongano quegli id in uno dei tre.

## Modifica 2 — MS: decorator `@BrokerAuth`

Il **3° parametro** passa da `roles: string[]` a `actions: string | string[]`.

```ts
// Firma nuova:
@BrokerAuth(authName: string, allowAnonymous?: boolean, actions?: string | string[], httpName?: string)
```

**Prima**

```ts
@BrokerAction('booking', 'get-booking')
@BrokerHTTP('GET', '/bookings/:id', 'params')
@BrokerAuth('riolabs-dev-jwks', false, ['user', 'admin'])   // 3° arg = ruoli
async getBooking(...) {}
```

**Dopo**

```ts
@BrokerAction('booking', 'get-booking')
@BrokerHTTP('GET', '/bookings/:id', 'params')
@BrokerAuth('riolabs-dev-jwks', false, ['booking.read'])    // 3° arg = azioni
async getBooking(...) {}
```

> Con route multiple sulla stessa action, il 4° parametro `httpName` accoppia l'auth alla singola
> route per `name` (invariato rispetto alla 2.0.x più recente).

## Modifica 3 — Wiring del gate in-process (gateway)

Invariato come provider, cambia solo il metodo usato dietro le quinte. Serve sempre registrare un
`IAclRoleService`:

```ts
ProxyModule.forRootAsync({
  // ...
  providers: [
    // Prima il commento diceva "canUserDoGtw"; ora risolve via AclService.checkAction
    { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService },
  ],
})
```

Se manca l'`IAclRoleService`, ogni route con `actions` nega (403).

## Modifica 4 — Superficie HTTP ACL (chiamanti che usano le action ACL)

| Prima | Dopo |
|---|---|
| `GET /acl/check` → `acl-can-user-do-gtw` | `GET /acl/check` → **`acl-check-action`** |
| `GET /acl/check-resource` → `acl-can-user-do` | **rimossa** (usare `/acl/check`) |
| `acl-verify-access`, `acl-list-by-user` | **rimosse** |

Nuova firma di `/acl/check`:

```
GET /acl/check?userId=<id>&action=<name>&companyId=<opt>&resourceId=<opt>   → 200 true|false
```

`action` accetta una stringa o più valori (OR). Ricorda: un RPC booleano risponde **`200 false`**
per "no" (non 204) — non trattare `200` come "autorizzato".

## Modifica 5 — `acl-grant` / `acl-revoke` ora sono GATED

Chi chiama grant/revoke (dal `X-GTW-AUTH-USERID` inoltrato) deve possedere l'azione
**`role-management`** sul target `(companyId, resourceId)`, altrimenti `403`. In alternativa, chi
possiede l'azione **`role-system`** (verificata resource-agnostic) può operare su qualsiasi risorsa
(bypass — vedi [05](05-acl-module-options.md)).

- Il payload di grant/revoke **resta invariato**: `{ userId, roles, resourceId?, companyId? }`.
  Le grant assegnano **ruoli** (`roles` obbligatorio; su revoke serve per rimuovere ruoli specifici).
- La grant è keyed su `(userId, companyId, resourceId)`; `grant` fa merge idempotente, `revoke`
  toglie i ruoli indicati ed elimina il record quando resta senza ruoli.

> **Chicken-and-egg (bootstrap):** nessun chiamante può concedere il primo `role-management`/`role-system`.
> **Va seminata a mano la prima grant nel DB.** Dettagli in [05](05-acl-module-options.md).

## Checklist

- [ ] Sostituito `roles:` con `actions:` in tutte le `gateway.paths[]` e `gateway.events[]`.
- [ ] Convertito il 3° arg di `@BrokerAuth` da ruoli ad azioni in tutti i MS.
- [ ] Verificato che le route protette espongano `companyId`/`resourceId` (params/query/body) quando serve lo scope.
- [ ] Aggiornati i chiamanti di `/acl/check` alla nuova query e rimossi gli usi di `/acl/check-resource`, `acl-verify-access`, `acl-list-by-user`.
- [ ] Predisposto un utente/servizio con `role-management` (o `role-system`) per grant/revoke, e seminata la prima grant nel DB.
