---
name: rlb-amqp-acl
description: Manage access control (ACL) with @open-rlb/nestjs-amqp — actions, roles, grants/revokes, and "can user do X" checks. Use when wiring AclModule, gating gateway routes by actions, granting/revoking a user's roles, listing a user's resources, or answering authorization/permission questions (actions, roles, grants, acl-check).
---

***REMOVED*** Manage ACL (@open-rlb/nestjs-amqp)

Read first when you need depth:
- `docs/acl.md` (model, wiring, URL table)
- `libs/rlb-nestjs-amqp/src/modules/acl/const.ts` (`ACL_ACTIONS`, `ACL_TOPIC`)
- `sample/config-sample/acl.yaml` (annotated broker + gateway reference)
- `sample/config-sample/gateway-in-memory/src/app.module.ts` (forRoot wiring)

Use when: managing **actions/roles/grants**, wiring `AclModule`, action-gating routes
(`actions: [...]`), or answering "can user do X".

***REMOVED******REMOVED*** Model (3 entities)

- **Action** — atomic capability (`read-doc`). Name-keyed.
- **Role** — bundle of action names (`editor = [read-doc, write-doc]`). Name-keyed.
- **Grant** — binds a `userId` → role names; one record per `(userId, companyId, resourceId)`.
- **Checks** resolve the requested **action** → roles-that-include-it, then match the
  user's grants. The route/gate names **actions**; grants still assign **roles**.

***REMOVED******REMOVED*** Decorator-bound (NOT configurable)

Topic NAME `rlb-acl` (`ACL_TOPIC`) and every action string are bound in the library —
reference them literally. The queue / exchange / routingKey that carry the topic ARE yours.

`ACL_ACTIONS`: `acl-action-list`, `acl-action-get`, `acl-action-update`,
`acl-action-delete`, `acl-role-list`, `acl-role-get`, `acl-role-update`,
`acl-role-delete`, `acl-grant`, `acl-revoke`, `acl-check-action`,
`acl-list-resources-by-user`, `acl-invalidate`.

> **Removed in 2.0.5:** `acl-list-by-user`, `acl-verify-access`, `acl-create` /
> id-based ACL CRUD. Entities are name-keyed: **PUT upserts, no POST.**

***REMOVED******REMOVED*** Actions & roles — name-keyed CRUD

No id, no POST. `PUT` upserts by `name` (idempotent), `GET` lists (`?page=&limit=`),
`GET …/get?name=` reads one, `DELETE` removes by `name`. Role upsert: every referenced
action must already exist (else **400**).

***REMOVED******REMOVED*** Grants — dual grant/revoke (now GATED)

One record per `(userId, companyId, resourceId)`. Both ops **require `userId` + `roles`**;
`resourceId` + `companyId` are **optional** but PART of the record identity.

- `acl-grant` — merges roles into the triple (creates if absent; idempotent).
- `acl-revoke` — removes roles; deletes the record once empty.
- Both validate every role exists (unknown role → **400**) and invalidate the user's cache.
- `companyId` (replaced `resourceBusinessId`) is **load-bearing**: it is part of the grant
  identity AND part of authorization (a grant matches only when its `companyId` equals the
  request's). It also groups `acl-list-resources-by-user` output.
- **Caller gating:** `acl-grant`/`acl-revoke` require the caller (forwarded
  `X-GTW-AUTH-USERID`) to hold the `role-management` action on the TARGET
  `(companyId, resourceId)`, else **403**. The gate action defaults to `role-management`,
  overridable via `AclModuleOptions.roleManagementAction`. Bootstrap by seeding the first
  `role-management` grant directly in the DB (no caller can grant it otherwise).

***REMOVED******REMOVED*** Checks — single primitive, GET → 200 with `true`/`false`

`false` is real content; only `null`/`undefined` collapses to 204. Returns `false`
(never throws) on missing input or error.

- `acl-check-action` → `checkAction(userId, ctx, action)`, `ctx = { companyId?, resourceId? }`,
  `action = string | string[]` (OR). Resolves the action(s) → roles-that-include-it, then
  matches the user's grants. A grant authorizes **iff** `grant.companyId === req.companyId &&
  grant.resourceId === req.resourceId` (undefined/null/`''` all count as absent). The ONLY
  carve-out: both ids absent on the request AND on the grant. **No wildcard** — a `null`
  `resourceId` no longer matches everything; `companyId` is load-bearing.
  Query: `?userId=&action=read-doc&companyId=acme&resourceId=doc-1`.
- `acl-list-resources-by-user` — **auth-gated** (needs `auth`, no actions): reads `userId`
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

Gateway side — let route `actions: [...]` gates run **in-process** (no broker hop) by
binding the gateway token to the same `AclService` (implements
`IAclRoleService.checkAction(userId, ctx, action)`):

```ts
import { ProxyModule, AclService, RLB_GTW_ACL_ROLE_SERVICE } from '@open-rlb/nestjs-amqp';

ProxyModule.forRoot({
  providers: [{ provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService }],
});
```

Same process → `useExisting`. Separate services → gateway RPCs `acl-check-action` on
`rlb-acl` instead. A route's `actions` are ACTION NAMES; the caller is authorized if it
holds **≥1** of them on the request's `(companyId, resourceId)`.

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
| acl-grant | POST | /acl/grants | body | acl-grant (gated: caller needs `role-management`) |
| acl-revoke | DELETE | /acl/grants | body | acl-revoke (gated: caller needs `role-management`) |
| acl-check | GET | /acl/check | query | acl-check-action |
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
      method: POST                 ***REMOVED*** gated: caller (X-GTW-AUTH-USERID) needs role-management on target
      path: /acl/grants
      dataSource: body
      topic: rlb-acl
      action: acl-grant
      mode: rpc
    - name: acl-check              ***REMOVED*** ?userId=&action=read-doc&companyId=&resourceId= → 200 true/false
      method: GET
      path: /acl/check
      dataSource: query
      topic: rlb-acl
      action: acl-check-action
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
- action-gated routes (`actions: [...]`) → `RLB_GTW_ACL_ROLE_SERVICE` bound to an
  `IAclRoleService` (`AclService`, `checkAction`). Auth-provider needs `uidClaim`
  (+ `headerPrefix`).
- `acl-grant`/`acl-revoke` are gated — seed the first `role-management` grant directly in
  the DB or every caller gets `403`.
- a check returning `false` is a **200**, not an error.
