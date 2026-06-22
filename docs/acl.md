***REMOVED*** ACL

Action-based access control for `@open-rlb/nestjs-amqp`. The ACL module ships a set of
`@BrokerAction` handlers (bound to a fixed broker topic) that answer the single
authorization question and manage the actions / roles / grants that back it. The gateway
also wires the same `AclService` in-process so it can enforce per-route action filters
without a round trip over the broker.

***REMOVED******REMOVED*** Introduction

ACL is built from three named entities and a small set of decisions:

- **Actions** — atomic capabilities (e.g. `read-doc`, `delete-user`). Keyed by `name`.
- **Roles** — named bundles of actions (e.g. `editor = [read-doc, write-doc]`). Keyed by `name`.
- **Grants** — bind a `userId` to one or more **roles**, scoped to a `(companyId, resourceId)`
  target (either may be absent).
- **Check** — a single primitive, `checkAction(userId, ctx, action)`, that resolves the
  requested action(s) to the roles that include them and verifies the user's grants on the
  exact `(companyId, resourceId)` in `ctx`.

All handlers are bound to the topic `rlb-acl` (the constant `ACL_TOPIC`). That topic name
and every action string are decorator-bound in the library and are **not** configurable —
your broker/gateway config must reference them literally.

***REMOVED******REMOVED*** Base features

***REMOVED******REMOVED******REMOVED*** Action-based authorization

A grant attaches a list of **role names** to a user; each role bundles **actions**.
Authorization is expressed in terms of **actions** through one primitive:

- `checkAction(userId, ctx, action)` returns `true` when the user holds **at least one** of
  the requested `action`s (OR-semantics) — via any role that includes it — on the exact
  `(companyId, resourceId)` in `ctx`. `action` is a `string | string[]`; `ctx` is
  `{ companyId?, resourceId? }`.

It is exposed two ways, both backed by the same method:

- **Over the broker** as the `acl-check-action` action on the `rlb-acl` topic (body
  `{ userId, action, companyId?, resourceId? }`).
- **In-process** as `IAclRoleService.checkAction(userId, ctx, action)` — what the gateway
  calls to gate a route without a broker round trip (bound via `RLB_GTW_ACL_ROLE_SERVICE`).

**The resource match is exact — there is no wildcard.** A grant authorizes a request iff its
`(companyId, resourceId)` equal the request's after normalization (`undefined`, `null` and
`''` all count as *absent* and compare equal). The **only** carve-out is when both ids are
absent on the request **and** on the grant — a legitimate resource-less / global grant. A
resource-less grant no longer authorizes a request that carries a `companyId`/`resourceId`,
and `companyId` is now **load-bearing** in the authorization decision (it is no longer
grouping-only metadata).

Pass `ctx === undefined` (rather than `{ }`) to skip resource scoping entirely — a
resource-agnostic check. The gateway uses this for WebSocket events, which carry no HTTP
resource.

The check returns `false` (never throws) on missing input or internal error.

***REMOVED******REMOVED******REMOVED*** Grants per user and target

There is exactly **one grant record per `(userId, companyId, resourceId)` triple** (an absent
`companyId`/`resourceId` is part of the key — absent ids compare equal). `grant` and `revoke`
are dual operations on that record:

- **grant** merges the supplied roles into the triple, creating the record if absent. It is
  idempotent — re-granting the same roles never produces a duplicate.
- **revoke** removes the supplied roles from the triple, and **deletes the record entirely
  once no roles remain**.

`companyId` and `resourceId` together identify the grant **and** scope authorization (see
the exact-match rule above). `companyId` replaced the old `resourceBusinessId`; it is no
longer grouping-only — it participates in both targeting and the authorization decision.
(It is still also used to group results in `acl-list-resources-by-user`.)

`grant` validates that every supplied role already exists (unknown roles → `400`), and both
operations invalidate the user's cached decisions on success.

***REMOVED******REMOVED******REMOVED*** Admin gate on grant / revoke

`grant` and `revoke` are themselves **gated**. The caller — identified by the forwarded
`X-GTW-AUTH-USERID` header — must hold the **`role-management`** action on the **target**
`(companyId, resourceId)`, checked with the same exact-match `checkAction`; otherwise the
operation throws `ForbiddenError` (→ `403`). An admin scoped to one company/resource cannot
manage grants on another.

The gate action defaults to `role-management`
(`ACL_DEFAULT_ROLE_MANAGEMENT_ACTION`) and is overridable per deployment via
`AclModuleOptions.roleManagementAction`. Because the gate is itself a grant, **bootstrap the
very first `role-management` grant by seeding the grant store directly** — the library adds
no bypass.

***REMOVED******REMOVED******REMOVED*** Gateway route gating (action-based)

The gateway gates HTTP routes and WebSocket events on **actions**, not roles. A route
declares the actions it requires; the gateway resolves the caller's identity from the auth
provider and authorizes via `checkAction`:

- **HTTP paths** declare `actions: [..]` on the `PathDefinition` (OR-semantics). The gateway
  resolves the caller's userId (the provider's `uidClaim`), extracts the request's
  `(companyId, resourceId)`, and authorizes if the caller holds **one** of `actions` on that
  target. Declaring `actions` **without** `auth` fails closed (`403`) — there is no identity
  to evaluate.
- **WebSocket events** declare `actions: [..]` and are checked **resource-agnostically** (WS
  events carry no HTTP resource): a subscriber passes if any grant includes one of the
  actions.

For HTTP paths the gateway reads the canonical `companyId` / `resourceId` from the request,
precedence **params → query → body**, and matches them exactly.

The exact-match rule (no wildcard) applies throughout: the caller's grant must match the
extracted `(companyId, resourceId)` exactly, the sole carve-out being both ids absent on the
request **and** the grant. See [the gateway docs](./gateway.md) for the full path/event
field reference, and note the `@BrokerAuth` decorator's 3rd parameter is now `actions` (was
`roles`): `@BrokerAuth(authName, allowAnonymous?, actions?, httpName?)`.

***REMOVED******REMOVED******REMOVED*** Two-level cache (L1 RAM + optional L2)

Check results are cached to avoid hitting the grant store on every request:

- **L1** — an in-process RAM map. Default TTL **30000 ms** (`ramTtlMs`).
- **L2** — an optional, pluggable store (e.g. Redis) supplied by your app via the
  `RLB_ACL_CACHE_STORE` token. Default TTL **600 s** (`l2TtlSec`). If no store is provided,
  the cache is RAM-only.

Lookups go L1 → L2; a hit in L2 re-populates L1. Any mutation (`grant`, `revoke`, action/role
upsert/delete) invalidates the relevant cache entries. The `acl-invalidate` action exists for
broadcast invalidation across instances (it clears the in-process RAM tier).

***REMOVED******REMOVED*** Nest configuration

***REMOVED******REMOVED******REMOVED*** Backend (the ACL microservice)

Register `AclModule.forRoot(providers, options)`. The first argument is a list of DI
bindings supplied by **your** app: the concrete repositories bound to the abstract
`AclActionRepository`, `AclRoleRepository` and `AclGrantRepository` tokens, plus the optional
L2 cache store under `RLB_ACL_CACHE_STORE`. The second argument carries cache TTLs.

```ts
import { Module } from '@nestjs/common';
import {
  AclModule,
  AclActionRepository,
  AclRoleRepository,
  AclGrantRepository,
  RLB_ACL_CACHE_STORE,
} from '@open-rlb/nestjs-amqp';

@Module({
  imports: [
    AclModule.forRoot(
      [
        // bind the abstract repository tokens to your concrete implementations
        { provide: AclActionRepository, useClass: MyAclActionRepository },
        { provide: AclRoleRepository, useClass: MyAclRoleRepository },
        { provide: AclGrantRepository, useClass: MyAclGrantRepository },

        // OPTIONAL L2 cache store (omit for RAM-only)
        { provide: RLB_ACL_CACHE_STORE, useClass: MyRedisAclCacheStore },
      ],
      {
        cache: {
          ramTtlMs: 30_000, // L1 TTL (default 30000)
          l2TtlSec: 600,    // L2 TTL (default 600)
        },
      },
    ),
  ],
})
export class AppModule {}
```

`AclModule` is registered as a **global** module and exports `AclService` and
`AclCacheService`.

***REMOVED******REMOVED******REMOVED*** Gateway side (in-process action filter)

So the gateway can enforce `actions: [...]` route filters without an extra broker round trip,
bind the gateway's `RLB_GTW_ACL_ROLE_SERVICE` token to the same `AclService`. The token
expects an `IAclRoleService` (`checkAction`), which `AclService` already implements:

```ts
import { Module } from '@nestjs/common';
import { ProxyModule, AclService, RLB_GTW_ACL_ROLE_SERVICE } from '@open-rlb/nestjs-amqp';

@Module({
  imports: [
    ProxyModule.forRoot({
      providers: [
        { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService },
      ],
    }),
  ],
})
export class GatewayModule {}
```

When the gateway and ACL backend run in the same process, `useExisting: AclService` reuses
the already-registered instance. If they run in separate services, the gateway instead
issues a broker RPC to the `acl-check-action` action on the `rlb-acl` topic.

***REMOVED******REMOVED*** YAML configuration

The ACL handlers consume the topic literally named **`rlb-acl`**, backed by a queue. Declare
both in the consuming service's broker config — the topic name is fixed and must match
exactly:

```yaml
broker:
  queues:
    ***REMOVED*** Queue consumed by the ACL backend handlers (AclService / AclManagementService).
    - name: rlb-acl
      exchange: rlb
      routingKey: rlb-acl
      createQueueIfNotExists: true
      options:
        durable: true

topics:
  ***REMOVED*** Topic the ACL @BrokerAction handlers bind to (ACL_TOPIC = 'rlb-acl').
  - name: rlb-acl
    mode: rpc
    queue: rlb-acl
    exchange: rlb
    routingKey: rlb-acl
```

***REMOVED******REMOVED*** Default configuration + URL table for ACL management

The gateway exposes the ACL actions over HTTP via `gateway.paths[]`. The table below mirrors
the shipped `sample/config-sample/gateway-in-memory/config/config.yaml`. Every path forwards to the `rlb-acl` topic
in `rpc` mode and maps to the action string shown.

> **Naming convention:** actions, roles and auth-providers are **name-keyed** — there is no
> separate id and **no POST**. `PUT` upserts by `name` (create-or-update, idempotent), `GET`
> lists, `GET …/get?name=` reads one, and `DELETE` removes by `name`.

***REMOVED******REMOVED******REMOVED*** Actions (name-keyed)

| Method | Path | Action | Behavior |
|---|---|---|---|
| `GET` | `/acl/actions` | `acl-action-list` | List actions (paginated; `?page=&limit=`). |
| `GET` | `/acl/actions/get?name=` | `acl-action-get` | Read a single action by `name`. |
| `PUT` | `/acl/actions` | `acl-action-update` | Upsert by `name`. Body: `{ name, description? }`. |
| `DELETE` | `/acl/actions` | `acl-action-delete` | Delete by `name`. Body: `{ name }`. |

***REMOVED******REMOVED******REMOVED*** Roles (name-keyed)

| Method | Path | Action | Behavior |
|---|---|---|---|
| `GET` | `/acl/roles` | `acl-role-list` | List roles (paginated; `?page=&limit=`). |
| `GET` | `/acl/roles/get?name=` | `acl-role-get` | Read a single role by `name`. |
| `PUT` | `/acl/roles` | `acl-role-update` | Upsert by `name`. Body: `{ name, actions, description? }`. All `actions` must exist (else `400`). |
| `DELETE` | `/acl/roles` | `acl-role-delete` | Delete by `name`. Body: `{ name }`. |

***REMOVED******REMOVED******REMOVED*** Grants (per user + target; admin-gated)

| Method | Path | Action | Behavior |
|---|---|---|---|
| `POST` | `/acl/grants` | `acl-grant` | Merge roles into the `(userId, companyId, resourceId)` grant. Body: `{ userId, roles, resourceId?, companyId?, friendlyName? }`. `userId` + `roles` **required**. |
| `DELETE` | `/acl/grants` | `acl-revoke` | Remove roles from the `(userId, companyId, resourceId)` grant; delete the record once empty. Body: `{ userId, roles, resourceId?, companyId? }`. `userId` + `roles` **required**. |

Both operations require `userId` and `roles`; `resourceId` and `companyId` are optional but
**part of the grant identity and the authorization scope** (not just metadata). Both are
**gated**: the caller (forwarded `X-GTW-AUTH-USERID`) must hold the `role-management` action
on the target `(companyId, resourceId)`, else `403` (`ForbiddenError`). Seed the first
`role-management` grant directly in the store to bootstrap.

***REMOVED******REMOVED******REMOVED*** Check and resource listing

| Method | Path | Action | Behavior |
|---|---|---|---|
| `GET` | `/acl/check` | `acl-check-action` | The single authorization primitive. Query: `?userId=&action=read-doc&action=write-doc&companyId=&resourceId=`. `action` is OR-semantics; `companyId`/`resourceId` scope the check (exact match, both absent ⇒ resource-less). Returns **200** with body `true`/`false`. |
| `GET` | `/acl/resources` | `acl-list-resources-by-user` | Authenticated. Lists the caller's accessible resources grouped by `companyId`, each with its resolved actions. Reads `userId` from the forwarded `X-GTW-AUTH-USERID` header (requires `auth`). |

> **A defined falsy result is real content.** `/acl/check` returns **200** with a JSON
> `true` or `false` body — `false` is a meaningful answer, not an empty one. Only a
> `null`/`undefined` result collapses to `204`.

> **Removed actions.** `acl-can-user-do`, `acl-can-user-do-gtw`, `acl-list-by-user` and
> `acl-verify-access` no longer exist. Use `acl-check-action` for every authorization check
> and `acl-list-resources-by-user` to enumerate a user's resources. The two old check routes
> (`/acl/check` and `/acl/check-resource`) collapse into the single `GET /acl/check`.

---

[← Back to index](./README.md)
