# gateway-hardening (sample)

A **focused** `@open-rlb/nestjs-amqp` gateway that wires **only the multi-instance hardening
features** — nothing else. Everything persistent is in-memory, so the only external dependency is
**RabbitMQ**.

It is meant to be read and copied from, not to be a full gateway. For a complete gateway see
`gateway-db` (Mongo/Influx) or `gateway-in-memory`.

## What it demonstrates

| # | Feature | Where it is wired |
|---|---------|-------------------|
| **#2** | **Cross-instance ACL cache invalidation** over AMQP | `AclModule.forRoot(..., { invalidation: { exchange } })` in [`app.module.ts`](src/app.module.ts) + the `rlb-acl-invalidate` **fanout** exchange in [`config.yaml`](config/config.yaml) |
| **#3** | **Bounded ACL L1 (RAM) cache** | `cache.maxRamEntries` in [`app.module.ts`](src/app.module.ts) |
| **#4** | **Scheduler lock** for the rollup/retention jobs | `RLB_GW_SCHED_LOCK` provider ([`in-memory-scheduler-lock.ts`](src/hardening/in-memory-scheduler-lock.ts)) passed to `GatewayAdminModule.forRoot` |
| **#5** | **HTTP body-size limit + in-flight concurrency cap** | `gateway.maxBodyBytes` (applied in [`main.ts`](src/main.ts)) + `gateway.maxConcurrentRequests` in [`config.yaml`](config/config.yaml) |

All four are **opt-in and back-compatible**: remove the config/provider and the gateway behaves as
before.

## Run

```bash
# from this folder (needs a RabbitMQ on localhost:5672, guest/guest)
npm install
npm run start
```

On boot you should see, among the logs:

- `[acl] cross-instance invalidation active on exchange 'rlb-acl-invalidate' (…)` — #2
- `[gateway] HTTP concurrency cap enabled: 100 in-flight requests` — #5
- `[retention] pruned …` preceded by a `[sched-lock] acquired 'gw-retention'` (debug) — #4
- `[seed] ready — Basic admin:secret can grant 'reader' …`

> The scheduler lock and the ACL invalidation only show their multi-instance value with **two
> instances**. Start a second one on another port:
> ```bash
> PORT=3001 npm run start
> ```
> Inside the monorepo you can instead launch the VS Code compound **“Debug gateway-hardening (two
> instances)”** (ports **3003** and **3004** — adjust the demo URLs below accordingly).

## Demo #2 — cross-instance ACL invalidation

Terminal A = instance on `:3000`, terminal B = instance on `:3001` (both share the same RabbitMQ).

```bash
# 1) admin grants user 'alice' the 'reader' role (→ gateway-access) — via instance A
curl -u admin:secret -X POST localhost:3000/acl/grants \
  -H 'content-type: application/json' -d '{"userId":"alice","roles":["reader"]}'

# 2) alice can reach /protected on BOTH instances (decision now cached in each instance's L1)
curl -u alice:secret localhost:3000/protected   # 200
curl -u alice:secret localhost:3001/protected   # 200

# 3) admin REVOKES on instance A only
curl -u admin:secret -X DELETE localhost:3000/acl/grants \
  -H 'content-type: application/json' -d '{"userId":"alice","roles":["reader"]}'

# 4) instance B reflects it IMMEDIATELY (its L1 RAM was flushed by the broadcast), not after 30s
curl -u alice:secret localhost:3001/protected   # 403
```

Without #2, step 4 would keep returning `200` on instance B for up to `cache.ramTtlMs` (30s).
Comment out the `invalidation` option in `app.module.ts` to see the difference.

## Demo #5 — body limit & concurrency cap

```bash
# body over 1mb → 413
curl -u admin:secret -X POST localhost:3000/acl/grants \
  -H 'content-type: application/json' --data-binary @a-2mb-file.json    # 413

# hammer the gateway past maxConcurrentRequests → some 503 (Retry-After: 1)
seq 1 500 | xargs -P50 -I{} curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/health | sort | uniq -c
```

## Demo #4 — scheduler lock

The retention job runs at boot and the rollup job hourly. With the in-memory lock each **process**
dedups its own ticks; to dedup **across instances** replace `InMemorySchedulerLock` with a shared
implementation — ready-to-use Redis and Mongo snippets are in
[`in-memory-scheduler-lock.ts`](src/hardening/in-memory-scheduler-lock.ts). With a shared lock, only
one instance logs `[retention] pruned …` / `[rollup] …` per tick; the others log
`skipped this tick: lock held by another instance` (debug).

## Notes

- `SeedService` is demo-only bootstrap (an `admin` user holding `role-management`); a real
  deployment seeds the first grant out-of-band.
- The ACL L2 store here is an in-process Map ([`in-memory-acl-store.ts`](src/cache/in-memory-acl-store.ts));
  in production use Redis so the L2 tier is shared — the #2 broadcast then only needs to flush L1.
