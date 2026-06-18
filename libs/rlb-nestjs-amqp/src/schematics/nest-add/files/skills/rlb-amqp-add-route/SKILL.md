---
name: rlb-amqp-add-route
description: Expose a broker action over HTTP through the @open-rlb/nestjs-amqp gateway by adding a gateway.paths[] entry. Use when the user wants a new HTTP endpoint/REST route that forwards to a topic/action, choosing rpc (wait reply) vs event (fire-and-forget with confirm), with auth, roles, dataSource, timeout, file upload or raw body. Generates the YAML path fragment and flags required bootstrap/ACL wiring.
---

***REMOVED*** Add an HTTP gateway route (gateway.paths[])

Read first:
- `.claude/skills/rlb-amqp/references/config-schema.md` (the `gateway.paths[]` section)
- `.claude/skills/rlb-amqp/references/gotchas.md` (HTTP + auth items)
- `docs/gateway.md` is the authority for the `PathDefinition` fields and status mapping.

The target `topic`+`action` should already have a handler (otherwise also run
`rlb-amqp-add-action`). The route only needs the topic to exist in `topics[]`.
Canonical example: `sample/config-sample/gateway-in-memory/config/config.yaml`.

***REMOVED******REMOVED*** Decide

- **mode**: `rpc` (return the handler's reply) or `event` (publish-and-confirm, no reply).
- **dataSource**: how the payload is assembled — `req.params` are ALWAYS merged in, plus:
  `body` | `query` | `params` | `body-query` (body wins) | `query-body` (query wins).
- **auth**: an `auth-provider` name (validates the request, maps claims to `X-GTW-AUTH-*`
  headers). `allowAnonymous: true` skips the gate. `roles: [...]` adds a role check.
- Extras: `timeout` (rpc), `successStatusCode`, `binary`, `redirect`, `parseRaw`, static
  `headers`, `forwardHeaders`.

***REMOVED******REMOVED*** PathDefinition fields (all of them)

| Field | Notes |
| --- | --- |
| `name` | Unique; used in logs + metrics. |
| `method` | `GET` `POST` `PUT` `DELETE` `PATCH` … |
| `path` | Express route, may carry `:params` (e.g. `/users/:id`). |
| `topic` / `action` | Broker destination. Action strings are decorator-bound on the backend. |
| `mode` | `rpc` \| `event`. |
| `dataSource` | `body` \| `query` \| `params` \| `body-query` \| `query-body`. |
| `auth` | Auth-provider name; validates + maps claims. |
| `allowAnonymous` | `true` → gate skipped (token still mapped if present & valid). |
| `roles` | Role NAMES; caller passes with AT LEAST ONE. Requires `auth`. |
| `timeout` | RPC timeout (ms), `rpc` only. |
| `binary` | Treat a raw (non-JSON) RPC reply as base64 → binary body. |
| `parseRaw` | Adds the raw request body as `$raw` (needs `rawBody: true`). |
| `successStatusCode` | Override success status (default 200 rpc / 202 event / 204 empty). |
| `redirect` | On an `rpc` route, redirect with this status using the reply as the location. |
| `headers` | Static response headers `{ k: v }`. |
| `forwardHeaders` | `{ dest: srcHeader }` — copy request headers downstream (prefixed by `gateway.headerPrefix`). |

Uploaded multipart files (any field) are attached as `$files` (buffers → binary strings).

***REMOVED******REMOVED*** YAML fragment

```yaml
gateway:
  paths:
    - name: <unique-name>
      method: POST                 ***REMOVED*** GET | POST | PUT | DELETE | PATCH
      path: /resource/:id?
      dataSource: body
      topic: <topic>
      action: <action>
      mode: rpc                    ***REMOVED*** or event
      auth: gateway-jwks           ***REMOVED*** optional
      roles: [resource.write]      ***REMOVED*** optional → needs RLB_GTW_ACL_ROLE_SERVICE
      timeout: 7000                ***REMOVED*** rpc only
      successStatusCode: 201
```

***REMOVED******REMOVED*** The 3-case auth gate

For every request the gateway runs `processAuthData` (best-effort), then:

1. **`allowAnonymous: true`** → gate SKIPPED. A valid token still gets its claims mapped &
   forwarded; a missing/invalid token is NOT blocked.
2. **`auth` set, no `roles`** → authentication only. Provider must validate (else `401`);
   on success the `X-GTW-AUTH-*` headers are forwarded downstream.
3. **`auth` + `roles`** → authn + role authz. After a valid token the gateway reads the user
   id from the provider's `uidClaim` and calls `IAclRoleService.canUserDoGtw(roles, userId)`
   in-process. Passes with at least one role, else `403`.

> `roles` WITHOUT `auth` is a misconfiguration: no identity → fails closed (every request
> `403`, logged loudly at boot). The resource-scoped check (`acl-can-user-do`) is NOT run by
> the gateway — it lives on the target microservice.

***REMOVED******REMOVED*** Status mapping

**`rpc`** reply → status:

| Reply | Status |
| --- | --- |
| Defined value (incl. falsy `false` / `0` / `''`) | `200` + body |
| `null` / `undefined` | `204 No Content` |

> ONLY `null`/`undefined` collapses to `204`. A defined falsy result is real content, so a
> boolean check route answers `200` with body `false` — not an empty `204`.

**`rpc`** error → status (by error `name`):

| Error name | Status |
| --- | --- |
| `BadRequestError`, `InvalidParamsErrror` | `400` |
| `UnauthorizedError` | `401` |
| `ForbiddenError` | `403` |
| `NotFoundError` | `404` |
| `ConflictError` | `409` |
| (any other) | `500` |

**`event`** route: successful publish → `successStatusCode || 202`; publish failure → `503`.

***REMOVED******REMOVED*** Required wiring to flag

- If `parseRaw: true` → bootstrap with `NestFactory.create(AppModule, { rawBody: true })`.
- If `roles` is used → an `IAclRoleService` must be registered via `RLB_GTW_ACL_ROLE_SERVICE`
  in `ProxyModule.forRootAsync({ providers: [{ provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService }] })`.
  If a path declares `roles` and the service is NOT registered → request DENIED (`403`) +
  error logged. The auth-provider needs a `uidClaim` (+ `headerPrefix`) to resolve the userId.
- Forwarded auth claims reach the handler as prefixed/uppercased headers
  (e.g. `X-GTW-AUTH-USERID`) — read them with `@BrokerParam('header', ...)`. Request headers
  can never override mapped claim headers (anti-spoofing).

***REMOVED******REMOVED*** Verify

- topic exists in `topics[]` and resolves.
- route-param vs body/query key collisions are intentional (params always merge in).
- `npm run build`, then optionally curl the route once the broker is up.

Output the YAML fragment (with parent path), plus any bootstrap/ACL action the user still
needs to take.
