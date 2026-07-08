# YAML migration scripts

Two helper scripts under `scripts/` migrate an existing gateway `config.yaml` into the newer,
DB-managed + auto-discovery world. They solve **different** problems and are usually run together,
in order:

| Script | Runs where | Reads | Produces | Use it to… |
| --- | --- | --- | --- | --- |
| `gateway-paths-to-http.js` | once, against the gateway YAML | `gateway.paths[]` | HTTP calls (`.http` / curl / NDJSON) **or** live POSTs to `gw-path-create` | bulk-load the existing routes (with their per-path auth) into the gateway-admin **DB** |
| `broker-http-decorators.js` | inside **each** microservice repo | the gateway YAML + the service's `src/` | edits `.ts` files in place, adding `@BrokerHTTP` (+ decoupled `@BrokerAuth`) | make the microservice **code self-describe** its routes so route auto-discovery can publish them |

Both depend on `js-yaml` (`npm i -D js-yaml`).

---

## When to use which

- **Script 1 — bulk DB insert.** You have a gateway YAML with a populated `gateway.paths[]` and you
  want those routes (and the auth/roles already declared on each path) loaded into the gateway-admin
  database without hand-writing the inserts. This is a one-shot data migration from YAML → DB.

- **Script 2 — make the MS code self-describe its routes.** You are moving to route **auto-discovery**,
  where each microservice announces its own HTTP routes on boot. The routes must live as `@BrokerHTTP`
  decorators next to the `@BrokerAction` handlers. This codemod stamps them in for you, reading the
  same YAML so the generated routes match what the gateway already serves, and wiring auth as
  **decoupled** `@BrokerAuth` per the per-route auth model.

A typical migration runs Script 1 once (to seed the DB), then Script 2 in each microservice (so the
services own their route definitions going forward).

---

## Script 1 — `gateway-paths-to-http.js`

Turns each `gateway.paths[]` entry into an insert against the gateway-admin create endpoint
(`POST /admin/paths`, the `gw-path-create` handler). Each YAML path entry already **is** a
`PathDefinition`, so it is passed through almost verbatim as the `StoredHttpPath` body — including its
`auth`, `roles`, `allowAnonymous`, `dataSource`, etc. — and the server fills in `routeKey`. Auth from
the YAML is preserved per path.

Routes are **de-duplicated by identity (METHOD + path)**, because the create handler rejects a second
route with the same method+path (409). Skipped duplicates are reported on stderr. Disabled routes
(`enabled: false`) are skipped unless `--include-disabled` is set.

### Usage

```bash
node scripts/gateway-paths-to-http.js <config.yaml> [options]
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--base <url>` | `http://localhost:3000` | Gateway base URL, used in the output and by `--execute`. |
| `--endpoint <path>` | `/admin/paths` | The create endpoint. |
| `--format http\|curl\|json` | `http` | Output artifact format. Ignored when `--execute` is set. |
| `--out <file>` | stdout | Write the artifact here instead of stdout. |
| `--auth <value>` | — | Value for the auth header on every call (e.g. `"Bearer eyJ..."`). |
| `--auth-header <name>` | `Authorization` | Auth header name. |
| `--execute` | off | Actually POST every route (needs Node ≥ 18 global `fetch`). Prints a created/conflict/failed summary; 409s count as "already existed". |
| `--include-disabled` | off | Also emit routes with `enabled: false`. |

### Examples

```bash
# Generate a VS Code REST Client / IntelliJ .http file
node scripts/gateway-paths-to-http.js tfr.yaml --out insert-routes.http

# Generate a curl script for a remote gateway
node scripts/gateway-paths-to-http.js tfr.yaml --format curl --base https://gw.example.com > insert.sh

# Insert directly against a live gateway
node scripts/gateway-paths-to-http.js tfr.yaml --execute --base https://gw.example.com --auth "Bearer $TOKEN"
```

The `json` format emits **NDJSON** (one `StoredHttpPath` body per line) for piping into other tooling.

---

## Script 2 — `broker-http-decorators.js`

A codemod run **inside a microservice repo**. For every method already decorated with
`@BrokerAction(topic, action)`, it looks up the matching route(s) in the gateway YAML by
`topic + action` and inserts the paired decorators right after the `@BrokerAction`, following the
per-route auth model:

- **Single route** for a method → `@BrokerHTTP` with **no `name`**; the `@BrokerAuth` auto-pairs.

  ```ts
  @BrokerAction('booking', 'get-booking')
  @BrokerHTTP('GET', '/bookings/:id', 'params')
  @BrokerAuth('transfeero-dev-jwks', true)
  async getBooking(...) { ... }
  ```

- **Multiple routes** on one method → each `@BrokerHTTP` gets a `name`, and the paired `@BrokerAuth`
  references it via `httpName` (auth stays decoupled, paired per route):

  ```ts
  @BrokerHTTP('GET', '/bookings/:id',       'params', { name: 'get-booking' })
  @BrokerAuth('transfeero-dev-jwks', true, undefined, 'get-booking')
  @BrokerHTTP('GET', '/admin/bookings/:id', 'params', { name: 'admin-get-booking' })
  @BrokerAuth('transfeero-admin-jwks', undefined, undefined, 'admin-get-booking')
  ```

It also adds `BrokerHTTP` / `BrokerAuth` to the existing `@open-rlb/nestjs-amqp` import.

### Behaviour notes

- **dataSource down-map.** `@BrokerHTTP` only accepts `query | body | params`. A YAML `body-query`
  is down-mapped to `body` and `query-body` to `query`, each with an inline
  `// NOTE: original dataSource '…' is not expressible on @BrokerHTTP; using '…'` comment so the lossy
  mapping is visible.
- **Public routes.** A path with `auth: false` (or no `auth`) gets `@BrokerHTTP` but **no**
  `@BrokerAuth` — it stays public.
- **`action` disambiguation.** When a method declares more than one `@BrokerAction`, the generated
  `@BrokerHTTP` carries an `action` option so the http↔action pairing is deterministic. (This pairing
  is independent of the auth pairing.)
- **Idempotent.** A route whose `path` is already present in a sibling `@BrokerHTTP` is skipped, so the
  codemod is safe to re-run. Methods whose `(topic, action)` is not in the YAML are left untouched.
- **Warnings.** It warns when a YAML route is `mode: event` but the existing `@BrokerAction` has no
  `'event'` type (it never edits the 3rd `@BrokerAction` arg), and when a method ends up with multiple
  named routes (so you can review the per-route auth pairing).

### Usage

```bash
node broker-http-decorators.js <gateway.yaml> [--src ./src] [--write] [--quote single|double]
```

By default it is a **dry run** — it prints what it would change. Pass `--write` to apply the edits.

| Option | Default | Meaning |
| --- | --- | --- |
| `--src <dir>` | `src` | Directory of `.ts` sources to scan (skips `node_modules`, `dist`, `.git`, `*.spec.ts`). |
| `--write` | off (dry run) | Apply the edits in place instead of just printing them. |
| `--quote single\|double` | `single` | Quote style for the generated decorator string literals. |

### Examples

```bash
# Dry run — preview the decorators that would be added
node ../gateway/scripts/broker-http-decorators.js ../gateway/tfr.yaml --src ./src

# Apply them
node ../gateway/scripts/broker-http-decorators.js ../gateway/tfr.yaml --src ./src --write
```
