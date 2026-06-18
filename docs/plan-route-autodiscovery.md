***REMOVED*** Plan — Microservice route auto-discovery → gateway DB sync → reload

> Status: **IMPLEMENTED, simplified & refactored, live-verified (2026-06-16).** The standalone
> `route-discovery` module was DISSOLVED:
> - **Publisher (a microservice announcing itself) → `modules/broker`** (`RouteDiscoveryPublisherService`,
>   registered by `BrokerModule`). Its config is a top-level `routeDiscovery` section threaded via
>   `BrokerModule.forRootAsync` (`RLB_ROUTE_DISCOVERY_OPTIONS`). The `ROUTE_DISCOVERY_EXCHANGE` /
>   `ROUTE_SYNC_QUEUE` constants + `RouteManifest` + the `buildPathDefinitionsFromMeta` mapper also
>   live in broker (loosely typed, so broker does NOT depend on proxy).
> - **Gateway (receives only) → `modules/gateway-admin`**: `RouteSyncService` (wired by
>   `GatewayAdminModule`) + diff + journal + `RouteSyncLogRepository`.
> - The `remote-config` module was removed. Dependency direction stays one-way: broker ← proxy ← gateway-admin.
>
> **Simplification applied (2026-06-16).** The shipped version is leaner than the sections below describe:
> - `RouteManifest` is just `{ service, routes }` — no `hash`/`schemaVersion`/`instanceId`/`generatedAt`.
> - **No manifest-hash short-circuit and no `RouteManifestStore`** (one fewer repository). The gateway always diffs; it reloads ONLY on a real change, so there are no spurious reloads.
> - **Route identity = `(method, path)`** (the gateway's Express routing key). `topic`/`action` are updatable target fields; a route is "changed" when its full content differs (compared via `routeContent`, key-order-independent). The per-route `hash` column is gone.
> - The route-sync log is a **journal**: one `RouteSyncLogEntry` per `added` / `updated` / `removed` / `collision` / `invalid` / `reload`.
> - `HttpPathRepository` gained a simple `filter(...)` method; `findByOwner`/`findByRouteKey` build on it.
> Goal: a generic microservice publishes its discovered route metadata over AMQP; the
> gateway, on receipt, diffs it against the DB, persists only what changed, and triggers a
> reload that rebuilds the Express routes from the database.

---

***REMOVED******REMOVED*** 1. Target flow

```
MS boot
  └─(onApplicationBootstrap) build manifest from AutoDiscoveryService.meta
       └─ publish manifest (AMQP) ──► gateway sync consumer (SINGLE writer)
                                          ├─ compare manifest hash vs DB (per service)
                                          ├─ if unchanged → stop (no DB write, no reload)
                                          ├─ upsert changed routes, disable stale ones (scoped to that service)
                                          └─ publish reloadTopic (broadcast)
                                                 └─ EVERY gateway instance → HttpHandlerService.reload()
                                                        └─ pulls DB paths via loadConfig.paths (gw-path-export) and rebuilds router
```

Two distinct channels, on purpose:
- **DB write = single consumer** (one durable shared queue) → avoids N instances racing on the DB.
- **Reload = broadcast** (`gateway.reloadTopic`) → every instance rebuilds its own router.

---

***REMOVED******REMOVED*** 2. Building blocks that already exist (reuse, don't reinvent)

| Piece | Where | Reuse for |
| --- | --- | --- |
| `AutoDiscoveryService.meta` (= `MetadataScannerService.metaInfo`) | broker | the MS's discovered decorator metadata (source) |
| `buildPathDefinitionsFromMeta(meta)` mapper | (was added then reverted) | metaInfo → `PathDefinition[]` |
| ~~`RemoteConfigService` + `config.ms`~~ | (removed) | the dedicated `rlb-route-discovery` channel replaced it; the `remote-config` module was deleted in the refactor |
| `GatewayPathService` (`gw-path-create/update/delete/list/export`), `GATEWAY_ADMIN_TOPIC='rlb-gateway-admin'` | modules/gateway-admin | DB CRUD for routes |
| `HttpPathRepository` / `StoredHttpPath` / `listEnabled()` / `orderPaths()` | modules/gateway-admin | persistence contract + ordered export |
| `gateway.loadConfig.paths` → `gw-path-export` → `HttpHandlerService.reload()` | proxy | DB paths already merged into the router on reload |
| `gateway.reloadTopic` (broadcast) → `reload()` | proxy | runtime, multi-instance reload signal (already wired) |

> Net new work is just: **MS publisher** + **gateway sync consumer (diff/upsert/disable)** + small **repo/schema additions**. The mapping and the reload path already exist.

---

***REMOVED******REMOVED*** 3. Key design decisions (recommendation in **bold**)

1. **Who maps metaInfo → PathDefinition?**
   - (a) **MS maps and sends `PathDefinition[]`** → gateway stays decorator-agnostic. *(recommended)*
   - (b) MS sends raw `metaInfo`; gateway maps. Matches "manda il discover metadata" literally but couples the gateway to decorator internals.

2. **Publish transport.**
   - (a) **fire-and-forget event to a durable queue** (work-queue, one consumer) → decoupled, resilient if the gateway is down. *(recommended)*
   - (b) RPC with ack/diff-result → MS gets feedback but blocks on gateway availability.

3. **DB writer concurrency.** Manifest must land on **one durable, shared queue consumed by a single gateway instance at a time** (competing consumers), NOT a per-instance fanout — otherwise every instance writes the DB. *(must-have)*

4. **Stale routes** (in DB for this service, absent from the new manifest):
   - **soft-disable (`enabled:false`)** *(recommended — reversible, audit-friendly)* vs hard-delete.

5. **Service identity / ownership.** Each manifest carries a `service` id; the gateway only ever touches DB routes owned by that `service`. Source of the id:
   - **explicit `serviceName` in config** *(recommended)* vs derive from `connection_name`.

6. **Path collisions across services** (two services claim `GET /x`): **DECIDED — skip the conflicting route AND persist a log entry** in a dedicated route-sync log collection (§6/§7). YAML `gateway.paths` always win over DB (already the case via merge order).

7. **Change detection.** Per-service **manifest content hash**; if the incoming hash equals the stored one → no-op (skip DB + skip reload). Per-route hash for granular upserts.

---

***REMOVED******REMOVED*** 4. Message protocol (manifest envelope)

```jsonc
{
  "schemaVersion": 1,
  "service": "orders-service",      // ownership key (scopes the diff)
  "instanceId": "orders-service-1234",
  "hash": "sha256(routes)",         // short-circuit: skip if == stored
  "generatedAt": <epoch ms, passed in — Date.now() is unavailable in some contexts>,
  "routes": [ /* PathDefinition[] from buildPathDefinitionsFromMeta */ ]
}
```
- Validate each route: `method`, `path`, `topic`, `mode` required; reject malformed (don't poison the DB).
- The internal AMQP bus is trusted; if needed later, sign the manifest.

---

***REMOVED******REMOVED*** 5. Diff & upsert algorithm (gateway side, single writer)

```
on manifest(service, hash, routes):
  if hash == storedHash(service): return            ***REMOVED*** nothing changed → no reload
  routeKey(r) = `${r.method} ${r.path}`             ***REMOVED*** stable identity
  incoming = index routes by routeKey
  existing = repo.findByOwner(service)              ***REMOVED*** only this service's rows
  for r in incoming:
     if some OTHER owner already has an ENABLED route with this routeKey:
        RouteSyncLog.write(level=warn, event='collision', service, routeKey, conflictWith=otherOwner)
        continue                                    ***REMOVED*** decision 5: skip + persistent log
     upsert by (owner=service, routeKey)            ***REMOVED*** insert new / update changed (per-route hash)
  for e in existing where e.routeKey not in incoming:
     repo.disable(e._id)                            ***REMOVED*** decision 1: soft-disable stale
  store storedHash(service) = hash
  if anyChange: publish(reloadTopic, {})            ***REMOVED*** broadcast → all instances reload from DB
```

Pure, deterministic, unit-testable in isolation (no broker/DB needed for the diff function itself).

---

***REMOVED******REMOVED*** 6. Components & file-level changes

**Broker / MS side**
- Re-introduce `buildPathDefinitionsFromMeta` as a shared util (e.g. `modules/broker/.../route-manifest.ts`), unit-tested.
- New `RouteDiscoveryPublisherService` (gated by config): `onApplicationBootstrap` → build manifest (service id + hash + routes from `AutoDiscoveryService.meta`) → publish to the discovery exchange/queue. No-op if disabled or no routes.
- Config: `routeDiscovery: { enabled, serviceName, exchange/queue names, publishOnBoot }` (+ a topic in `broker.topics`).

**Gateway-admin side**
- Extend `StoredHttpPath` with `owner` (service id), `routeKey`, `hash`.
- Extend `HttpPathRepository` contract: `findByOwner(owner)`, `upsertByOwnerKey(owner, routeKey, model)`, `disableById(id)` (or `disableMissing(owner, keepKeys)`), and a per-service manifest-hash store (small `RouteManifestRepository` or a field).
- New `RouteSyncService` with a handler bound to a **durable shared queue** (competing consumers → single processing): runs the §5 algorithm, then publishes `reloadTopic`.
- **Route-sync log collection (decision 5):** new `RouteSyncLogRepository` (abstract contract; consumer provides the impl) + `RouteSyncLogEntry` model `{ _id, ts, service, level, event, routeKey?, method?, path?, owner?, conflictWith?, message }`. Written on every collision-skip (and reusable for upsert/disable audit). Optional read handler `gw-route-log-list` for a frontend.
- Update the in-memory impls in `apps/gateway-2` accordingly (incl. an `InMemoryRouteSyncLogRepository`), so it runs without Mongo.

**Gateway / proxy side**
- `HttpHandlerService.reload()` already pulls DB paths and rebuilds — **no change needed** (verify dedup + that the local decorator-bridge, if ever re-enabled, doesn't double-register).

**Wiring**
- MS module registers the publisher; gateway registers the sync consumer + the shared queue. All gated by config so a plain MS or a YAML-only gateway is unaffected.

---

***REMOVED******REMOVED*** 7. Multi-instance, idempotency, ordering

- **Single writer via competing consumers (answers "how, if instances are already running?")**: every gateway instance subscribes to the SAME named, **durable, non-exclusive** queue (e.g. `rlb-route-sync`). RabbitMQ delivers each manifest to **exactly one** connected consumer (round-robin / fair dispatch, `prefetch=1`) — you do NOT elect a special instance; N instances can be up and each message is still processed once. This is the OPPOSITE of the WebSocket queues (per-instance & exclusive for fan-out). Durable queue+exchange+messages ⇒ a manifest published while NO gateway is up waits in the queue until one connects ("RabbitMQ won't lose data", decision 2).
- **Per-service write race**: two manifests for the same `service` processed concurrently converge via a **unique index / upsert key on `(owner, routeKey)`** + the hash short-circuit. Optional strong guarantee: route a service's manifests to a single consumer with a consistent routing key. Low risk (publishes are infrequent).
- **Idempotent**: re-publishing the same manifest (same hash) is a no-op; redelivery (at-least-once) is safe.
- **Ordering**: `gw-path-export` already returns paths ordered static-before-param (`orderPaths`), so reload registration order is correct.
- **Reload is async** (broker round-trip): tests must tolerate a brief propagation window (the existing Postman folders already busy-wait ~1s).
- **At-least-once delivery**: the handler must be safe to run twice (diff is idempotent).

---

***REMOVED******REMOVED*** 8. Edge cases / gotchas

- A service that crashes/leaves: its DB routes linger. Optional TTL/heartbeat or an explicit "service offline" cleanup (out of scope v1; soft-disabled rows are harmless).
- Manifest larger than frame limits: chunk or rely on AMQP body size (manifests are small; fine).
- Two instances of the SAME service publishing slightly different manifests (rolling deploy): last manifest wins per `service`; hash short-circuit limits churn.
- **Production persistence MUST enforce a UNIQUE index on `routeKey` + atomic upsert.** The diff is idempotent but not transactional; concurrent manifests from different services can race the read-then-write. The in-memory demo has no constraint, so a real DB closes this gap. (Reviewed 2026-06-16.)
- **Trust model:** the manifest `service` claim is NOT signed — the internal AMQP bus is trusted. Sign/HMAC manifests if untrusted producers can publish to the bus.
- **Collision coverage:** YAML routes + other services' DB routes (any enabled state, incl. soft-disabled) are collision-checked. Manually-created admin routes (no `routeKey`) are NOT — manage those deliberately.
- **Eventual consistency on failure:** a partial write or a collision is NOT acked-and-forgotten — the manifest hash is only stored on a clean, collision-free apply, so the next (re)publish re-runs the idempotent diff and completes.
- Never let a service touch YAML routes or another service's rows (scope every query by `owner`).
- `Date.now()`/random unavailable in some execution contexts (workflow scripts) — stamp `generatedAt` where it IS available (the MS process), not in restricted contexts.

---

***REMOVED******REMOVED*** 9. Phased task breakdown (execution order)

- **Phase 0 — decisions.** Resolve §10 open questions.
- **Phase 1 — manifest core.** Shared mapper + manifest type + hashing. Pure unit tests.
- **Phase 2 — MS publisher.** `RouteDiscoveryPublisherService` + config; publishes on boot (gated).
- **Phase 3 — persistence.** `StoredHttpPath`/`HttpPathRepository` additions + manifest-hash store + `RouteSyncLogRepository` (collision log); in-memory impls in gateway-2.
- **Phase 4 — gateway sync consumer.** `RouteSyncService` on a durable shared queue: §5 diff/upsert/disable + reload broadcast. Unit-test the diff function.
- **Phase 5 — end-to-end.** Live broker run + a Postman/Newman folder: start a "fake MS" publisher (or the gateway itself), assert routes appear/disappear after publish without restart.
- **Phase 6 — hardening.** Collision policy, validation, ownership scoping, logging/metrics, docs + skill update.

---

***REMOVED******REMOVED*** 10. Decisions

**Resolved (2026-06-16):**
1. Stale routes → **soft-disable** (`enabled:false`).
2. Publish transport → **durable event** (durable exchange + durable queue + persistent messages; RabbitMQ buffers, never loses).
3. Service identity → **explicit `serviceName` in config**.
4. Mapping → **MS sends `PathDefinition[]`** (gateway stays decorator-agnostic).
5. Cross-service path collision → **skip the route AND persist a log entry** in a dedicated route-sync log collection (`RouteSyncLogRepository`).

6. Source of truth → **YAML + DB coexist**: YAML `gateway.paths` holds the internal/core routes (ACL, admin, system); the DB holds the auto-discovered microservice routes. Both are merged in `reload()`; YAML wins on conflict.
7. Discovery channel → **dedicated durable exchange `rlb-route-discovery`** (do NOT reuse `config.ms`). The durable, non-exclusive shared work-queue `rlb-route-sync` binds to it (competing consumers). Reload still uses the existing `gateway.reloadTopic` broadcast.
