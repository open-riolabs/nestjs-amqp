---
name: rlb-amqp-acl
description: Manage role-based access control (ACL) with @open-rlb/nestjs-amqp — actions, roles, grants/revokes, and "can user do X" checks. Use when wiring AclModule, gating gateway routes by roles, granting/revoking a user's roles, listing a user's resources, or answering authorization/permission questions (roles, grants, acl-check).
---

***REMOVED*** Manage ACL (@open-rlb/nestjs-amqp)

Read first when you need depth:
- `docs/acl.md` (model, wiring, URL table)
- `libs/rlb-nestjs-amqp/src/modules/acl/const.ts` (`ACL_ACTIONS`, `ACL_TOPIC`)
- `sample/config-sample/acl.yaml` (annotated broker + gateway reference)
- `sample/config-sample/gateway-in-memory/src/app.module.ts` (forRoot wiring)

Use when: managing **actions/roles/grants**, wiring `AclModule`, role-gating routes
(`roles: [...]`), or answering "can user do X".

***REMOVED******REMOVED*** Model (3 entities)

- **Action** — atomic capability (`read-doc`). Name-keyed.
- **Role** — bundle of action names (`editor = [read-doc, write-doc]`). Name-keyed.
- **Grant** — binds a `userId` → role names; one record per `(userId, resourceId)`.
- **Checks** match on **roles, never action strings**.

***REMOVED******REMOVED*** Decorator-bound (NOT configurable)

Topic NAME `rlb-acl` (`ACL_TOPIC`) and every action string are bound in the library —
reference them literally. The queue / exchange / routingKey that carry the topic ARE yours.

`ACL_ACTIONS`: `acl-action-list`, `acl-action-get`, `acl-action-update`,
`acl-action-delete`, `acl-role-list`, `acl-role-get`, `acl-role-update`,
`acl-role-delete`, `acl-grant`, `acl-revoke`, `acl-can-user-do-gtw`,
`acl-can-user-do`, `acl-list-resources-by-user`, `acl-invalidate`.

> **Removed in 2.0.5:** `acl-list-by-user`, `acl-verify-access`, `acl-create` /
> id-based ACL CRUD. Entities are name-keyed: **PUT upserts, no POST.**

***REMOVED******REMOVED*** Actions & roles — name-keyed CRUD

No id, no POST. `PUT` upserts by `name` (idempotent), `GET` lists (`?page=&limit=`),
`GET …/get?name=` reads one, `DELETE` removes by `name`. Role upsert: every referenced
action must already exist (else **400**).

***REMOVED******REMOVED*** Grants — dual grant/revoke

One record per `(userId, resourceId)`. Both ops **require `userId` + `roles`**;
`resourceId` + `companyId` are **optional**.

- `acl-grant` — merges roles into the pair (creates if absent; idempotent).
- `acl-revoke` — removes roles; deletes the record once empty.
- Both validate every role exists (unknown role → **400**) and invalidate the user's cache.
- `companyId` (replaced `resourceBusinessId`) is **grouping metadata only** — it groups
  `acl-list-resources-by-user` output and plays **no part** in authorization.

***REMOVED******REMOVED*** Checks — GET → 200 with `true`/`false`

`false` is real content; only `null`/`undefined` collapses to 204. Both return `false`
(never throw) on missing input or error.

- `acl-can-user-do-gtw` — resource-**agnostic**, the gateway's primary filter. `true` if
  the user holds **≥1** requested role. Query: `?userId=&roles=user&roles=admin`.
- `acl-can-user-do` — resource-**scoped**: `true` if a **global** grant OR a grant bound
  to that exact `resource` gives a matching role. Query: `?userId=&roles=admin&resource=doc-1`.
  Normally called over the broker by the owning microservice.
- `acl-list-resources-by-user` — **auth-gated** (needs `auth`, no roles): reads `userId`
  from the forwarded `X-GTW-AUTH-USERID` header; lists accessible resources grouped by
  `companyId` with resolved actions.

***REMOVED******REMOVED*** Nest wiring

Backend — `AclModule.forRoot([bindings], { cache })`. Bind the abstract repo tokens to
your concrete impls + optional L2 store; second arg carries TTLs. Module is **global**,
exports `AclService` + `AclCacheService`.

```ts
import {
  AclModule, AclActionRepository, AclRoleRepository, AclGrantRepository,
  RLB_ACL_CACHE_STORE,
} from '@open-rlb/nestjs-amqp';

AclModule.forRoot(
  [
    { provide: AclActionRepository, useClass: MyAclActionRepository },
    { provide: AclRoleRepository,   useClass: MyAclRoleRepository },
    { provide: AclGrantRepository,  useClass: MyAclGrantRepository },
    { provide: RLB_ACL_CACHE_STORE, useClass: MyRedisAclCacheStore }, // OPTIONAL L2 (omit → RAM-only)
  ],
  { cache: { ramTtlMs: 30_000, l2TtlSec: 600 } }, // L1 RAM (default 30000) / L2 (default 600s)
);
```

Gateway side — let route `roles: [...]` filters run **in-process** (no broker hop) by
binding the gateway token to the same `AclService`:

```ts
import { ProxyModule, AclService, RLB_GTW_ACL_ROLE_SERVICE } from '@open-rlb/nestjs-amqp';

ProxyModule.forRoot({
  providers: [{ provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService }],
});
```

Same process → `useExisting`. Separate services → gateway RPCs `acl-can-user-do-gtw` on
`rlb-acl` instead. A route's `roles` are ROLE NAMES; the user passes with **≥1**.

***REMOVED******REMOVED*** YAML — topic + queue (names fixed, transport yours)

```yaml
broker:
  queues:
    - name: rlb-acl          ***REMOVED*** consumed by the ACL backend handlers
      exchange: rlb
      routingKey: rlb-acl
      createQueueIfNotExists: true
      options: { durable: true }
topics:
  - name: rlb-acl            ***REMOVED*** ACL_TOPIC — must match exactly
    mode: rpc
    queue: rlb-acl
    exchange: rlb
    routingKey: rlb-acl
```

***REMOVED******REMOVED*** Gateway paths[] — full ACL table

Every path forwards to topic `rlb-acl`, `mode: rpc`. `name` is a free label; `action` is
the fixed library string.

| name | method | path | dataSource | action |
|---|---|---|---|---|
| acl-action-list | GET | /acl/actions | query | acl-action-list |
| acl-action-get | GET | /acl/actions/get | query | acl-action-get |
| acl-action-upsert | PUT | /acl/actions | body | acl-action-update |
| acl-action-delete | DELETE | /acl/actions | body | acl-action-delete |
| acl-role-list | GET | /acl/roles | query | acl-role-list |
| acl-role-get | GET | /acl/roles/get | query | acl-role-get |
| acl-role-upsert | PUT | /acl/roles | body | acl-role-update |
| acl-role-delete | DELETE | /acl/roles | body | acl-role-delete |
| acl-grant | POST | /acl/grants | body | acl-grant |
| acl-revoke | DELETE | /acl/grants | body | acl-revoke |
| acl-check-gtw | GET | /acl/check | query | acl-can-user-do-gtw |
| acl-check-resource | GET | /acl/check-resource | query | acl-can-user-do |
| acl-list-resources-by-user | GET | /acl/resources | query | acl-list-resources-by-user (+ `auth:`) |

```yaml
gateway:
  mode: gateway
  paths:
    - name: acl-role-upsert        ***REMOVED*** PUT upserts by name. body: { name, actions, description? }
      method: PUT
      path: /acl/roles
      dataSource: body
      topic: rlb-acl
      action: acl-role-update
      mode: rpc
    - name: acl-grant              ***REMOVED*** body: { userId, roles, resourceId?, companyId?, friendlyName? }
      method: POST
      path: /acl/grants
      dataSource: body
      topic: rlb-acl
      action: acl-grant
      mode: rpc
    - name: acl-check-gtw          ***REMOVED*** ?userId=&roles=user&roles=admin → 200 true/false
      method: GET
      path: /acl/check
      dataSource: query
      topic: rlb-acl
      action: acl-can-user-do-gtw
      mode: rpc
    - name: acl-list-resources-by-user   ***REMOVED*** auth-gated; userId from X-GTW-AUTH-USERID
      method: GET
      path: /acl/resources
      dataSource: query
      topic: rlb-acl
      action: acl-list-resources-by-user
      mode: rpc
      auth: gateway-jwks
```

***REMOVED******REMOVED*** Verify

- topic `rlb-acl` + its queue declared on the consuming service; gateway paths use the
  literal `action` strings above.
- role-gated routes (`roles: [...]`) → `RLB_GTW_ACL_ROLE_SERVICE` bound to an
  `IAclRoleService` (`AclService`). Auth-provider needs `uidClaim` (+ `headerPrefix`).
- a check returning `false` is a **200**, not an error.
