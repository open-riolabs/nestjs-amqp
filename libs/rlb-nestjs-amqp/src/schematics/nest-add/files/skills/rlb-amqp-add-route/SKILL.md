---
name: rlb-amqp-add-route
description: Expose a broker action over HTTP through the @open-rlb/nestjs-amqp gateway by adding a gateway.paths[] entry. Use when the user wants a new HTTP endpoint/REST route that forwards to a topic/action, choosing rpc (wait reply) vs event (fire-and-forget with confirm), with auth, roles, dataSource, timeout, file upload or raw body. Generates the YAML path fragment and flags required bootstrap/ACL wiring.
---

***REMOVED*** Add an HTTP gateway route (gateway.paths[])

Read first:
- `.claude/skills/rlb-amqp/references/config-schema.md` (the `gateway.paths[]` section)
- `.claude/skills/rlb-amqp/references/gotchas.md` (HTTP + auth items 11–15)

The target `topic`+`action` should already have a handler (otherwise also run
`rlb-amqp-add-action`). The route only needs the topic to exist in `topics[]`.

***REMOVED******REMOVED*** Decide

- **mode**: `rpc` (return the handler's response) or `event` (202 after publisher confirm,
  503 on failure).
- **dataSource**: how to build the payload — `body` | `query` | `params` | `body-query` |
  `query-body` (see the composition table in the schema).
- **auth**: an `auth-provider` name; `allowAnonymous: true` to permit unauthenticated access;
  `roles: [...]` for ACL.
- Extras: `timeout` (rpc), `successStatusCode`, `binary`, `redirect`, `parseRaw`, static
  `headers`, `forwardHeaders`.

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
      roles: [resource.write]      ***REMOVED*** optional → needs IAclRoleService
      timeout: 7000                ***REMOVED*** rpc only
      successStatusCode: 201
```

***REMOVED******REMOVED*** Required wiring to flag

- If `parseRaw: true` → the app must bootstrap with
  `NestFactory.create(AppModule, { rawBody: true })` (gotcha 12).
- If `roles` is used → an `IAclRoleService` must be registered via
  `RLB_GTW_ACL_ROLE_SERVICE` in `ProxyModule.forRootAsync({ providers: [...] })`, and the
  auth-provider must define `aclTopic`/`aclAction`/`uidClaim`/`usernameClaim` (gotcha 15).
- Forwarded auth claims reach the handler as prefixed/uppercased headers
  (e.g. `X-GTW-AUTH-USERID`) — read them with `@BrokerParam('header', ...)`.

***REMOVED******REMOVED*** Verify

- topic exists in `topics[]` and resolves (gotchas 5–7).
- route-param vs body/query key collisions are intentional (gotcha 13).
- `npm run build`, then optionally curl the route once the broker is up.

Output the YAML fragment (with parent path), plus any bootstrap/ACL action the user still
needs to take.
