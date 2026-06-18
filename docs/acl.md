***REMOVED*** ACL

Role-based access control for `@open-rlb/nestjs-amqp`. The ACL module ships a set of
`@BrokerAction` handlers (bound to a fixed broker topic) that answer authorization
questions and manage the actions / roles / grants that back them. The gateway also wires
the same `AclService` in-process so it can enforce per-route role filters without a round
trip over the broker.

***REMOVED******REMOVED*** Introduction

ACL is built from three named entities and a small set of decisions:

- **Actions** — atomic capabilities (e.g. `read-doc`, `delete-user`). Keyed by `name`.
- **Roles** — named bundles of actions (e.g. `editor = [read-doc, write-doc]`). Keyed by `name`.
- **Grants** — bind a `userId` to one or more **roles**, optionally scoped to a `resourceId`.
- **Checks** — `canUserDoGtw` (resource-agnostic, the gateway's primary filter) and
  `canUserDo` (resource-scoped, evaluated by the owning microservice).

All handlers are bound to the topic `rlb-acl` (the constant `ACL_TOPIC`). That topic name
and every action string are decorator-bound in the library and are **not** configurable —
your broker/gateway config must reference them literally.

***REMOVED******REMOVED*** Base features

***REMOVED******REMOVED******REMOVED*** Role-based authorization

A grant attaches a list of **role names** to a user. Authorization never matches on action
strings directly — it matches on roles:

- `canUserDoGtw(roles, userId)` returns `true` when the user holds **at least one** of the
  requested roles, ignoring resource scoping. This is what the gateway calls for a route
  that declares `roles: [...]`.
- `canUserDo(roles, userId, resourceId?)` returns `true` when a **global** grant (no
  `resourceId`) **or** a grant bound to exactly that `resourceId` gives the user at least
  one of the requested roles. The resource is known only to the microservice, so this check
  is normally invoked over the broker by the service that owns the resource.

Both checks return `false` (never throw) on missing input or internal error.

***REMOVED******REMOVED******REMOVED*** Grants per user (and optional resource)

There is exactly **one grant record per `(userId, resourceId)` pair** (an absent
`resourceId` is its own "global" slot). `grant` and `revoke` are dual operations on that
record:

- **grant** merges the supplied roles into the pair, creating the record if absent. It is
  idempotent — re-granting the same roles never produces a duplicate.
- **revoke** removes the supplied roles from the pair, and **deletes the record entirely
  once no roles remain**.

`companyId` is **grouping-only metadata** (it replaced the old `resourceBusinessId`). It is
stored on the grant and used to group results in `acl-list-resources-by-user`, but it plays
**no part in authorization decisions** — targeting is by `(userId, resourceId)` only.

Both `grant` and `revoke` validate that every supplied role already exists (unknown roles →
`400`), and both invalidate the user's cached decisions on success.

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

***REMOVED******REMOVED******REMOVED*** Gateway side (in-process role filter)

So the gateway can enforce `roles: [...]` route filters without an extra broker round trip,
bind the gateway's `RLB_GTW_ACL_ROLE_SERVICE` token to the same `AclService`. The token
expects an `IAclRoleService` (`canUserDoGtw` / `canUserDo`), which `AclService` already
implements:

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
issues a broker RPC to the `acl-can-user-do-gtw` action on the `rlb-acl` topic.

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

***REMOVED******REMOVED******REMOVED*** Grants (per user; `resourceId` optional)

| Method | Path | Action | Behavior |
|---|---|---|---|
| `POST` | `/acl/grants` | `acl-grant` | Merge roles into the `(userId, resourceId)` grant. Body: `{ userId, roles, resourceId?, companyId?, friendlyName? }`. `userId` + `roles` **required**. |
| `DELETE` | `/acl/grants` | `acl-revoke` | Remove roles from the `(userId, resourceId)` grant; delete the record once empty. Body: `{ userId, roles, resourceId?, companyId? }`. `userId` + `roles` **required**. |

Both operations require `userId` and `roles`; `resourceId` and `companyId` are optional.
`companyId` is grouping metadata only and does not affect targeting.

***REMOVED******REMOVED******REMOVED*** Checks and resource listing

| Method | Path | Action | Behavior |
|---|---|---|---|
| `GET` | `/acl/check` | `acl-can-user-do-gtw` | Resource-agnostic role check. Query: `?userId=&roles=user&roles=admin`. Returns **200** with body `true`/`false`. |
| `GET` | `/acl/check-resource` | `acl-can-user-do` | Resource-scoped check (global grant OR grant bound to `resource`). Query: `?userId=&roles=admin&resource=doc-1`. Returns **200** with body `true`/`false`. |
| `GET` | `/acl/resources` | `acl-list-resources-by-user` | Authenticated. Lists the caller's accessible resources grouped by `companyId`, each with its resolved actions. Reads `userId` from the forwarded `X-GTW-AUTH-USERID` header (requires `auth`, no roles). |

> **A defined falsy result is real content.** `/acl/check` and `/acl/check-resource` return
> **200** with a JSON `true` or `false` body — `false` is a meaningful answer, not an empty
> one. Only a `null`/`undefined` result collapses to `204`.

> **Removed actions.** `acl-list-by-user` and `acl-verify-access` no longer exist. Use
> `acl-can-user-do` for resource-scoped checks and `acl-list-resources-by-user` to enumerate
> a user's resources.

---

[← Back to index](./README.md)
