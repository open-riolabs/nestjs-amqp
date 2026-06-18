/** Stable identity of a route within the gateway: METHOD + path. */
export function routeKeyOf(r: { method?: string; path?: string }): string {
  return `${(r.method || '').toUpperCase()} ${r.path || ''}`;
}

/** Behaviour-defining subset of a route (excludes persistence fields), in a stable key order. */
function canonicalRoute(r: any) {
  return {
    name: r.name, method: r.method, path: r.path, dataSource: r.dataSource,
    topic: r.topic, action: r.action, mode: r.mode, auth: r.auth ?? null,
    allowAnonymous: r.allowAnonymous ?? null, roles: r.roles ?? [],
    successStatusCode: r.successStatusCode ?? null, timeout: r.timeout ?? null,
    parseRaw: r.parseRaw ?? null, binary: r.binary ?? null, redirect: r.redirect ?? null,
    headers: r.headers ?? {}, forwardHeaders: r.forwardHeaders ?? {},
  };
}

/**
 * Order-independent JSON serialization: object keys are sorted recursively so two
 * semantically-equal objects (same content, different key order — e.g. `headers`) serialize
 * IDENTICALLY. Plain `JSON.stringify` is key-order-dependent and therefore NOT safe for hashing.
 * Arrays keep their order (it is semantic).
 */
export function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Canonical, order-independent string of a route's behaviour-defining content. Two routes with
 * the same content (regardless of object key order) produce the SAME string. The gateway uses it
 * to decide whether a stored route differs from the incoming one ("changed").
 */
export function routeContent(r: any): string {
  return stableStringify(canonicalRoute(r));
}

/** Minimal validation: a route must be routable by the gateway. `action` is required —
 *  the gateway forwards on (topic, action), so a missing action would fail at request time. */
export function isValidRoute(r: any): boolean {
  return !!(r && r.method && r.path && r.topic && r.action && (r.mode === 'rpc' || r.mode === 'event'));
}
