import { RouteFieldChange } from '../models';

/** Stable identity of a route within the gateway: METHOD + path. */
export function routeKeyOf(r: { method?: string; path?: string }): string {
  return `${(r.method || '').toUpperCase()} ${r.path || ''}`;
}

/** Behaviour-defining subset of a route (excludes persistence fields), in a stable key order. */
function canonicalRoute(r: any) {
  return {
    name: r.name, method: r.method, path: r.path, dataSource: r.dataSource,
    topic: r.topic, action: r.action, mode: r.mode, auth: r.auth ?? null,
    allowAnonymous: r.allowAnonymous ?? null, actions: r.actions ?? [],
    successStatusCode: r.successStatusCode ?? null, timeout: r.timeout ?? null,
    parseRaw: r.parseRaw ?? null, binary: r.binary ?? null, redirect: r.redirect ?? null,
    headers: r.headers ?? {}, forwardHeaders: r.forwardHeaders ?? {},
  };
}

/** Behaviour-defining field names (the keys of `canonicalRoute`) — single source of truth for both
 *  content-hashing and field diffing. Persistence/ownership fields are intentionally excluded. */
const ROUTE_FIELDS = Object.keys(canonicalRoute({}));

/** Route fields a user may override via the admin WITHOUT locking the whole route. When the user
 *  changes ONLY these, route auto-discovery keeps managing every OTHER field but PRESERVES the
 *  user's value for these (tracked per-route in `userOverrides`). Any other field the user changes
 *  marks the route `modified` (full lock). `enabled` is included even though it is a persistence
 *  field (not in ROUTE_FIELDS) — the diff handles it explicitly. */
export const USER_OVERRIDABLE_FIELDS = ['enabled', 'actions', 'allowAnonymous', 'timeout', 'redirect', 'successStatusCode'];

/** Take an incoming (MS) route but KEEP the stored route's value for every CONTENT field the user
 *  has overridden (`userOverrides`). `enabled` is skipped here (handled by the diff — it is not a
 *  content field). Returns `incoming` unchanged when there are no content overrides. */
export function applyUserOverrides(incoming: any, existing: any, userOverrides?: string[]): any {
  if (!userOverrides?.length || !existing) return incoming;
  const merged = { ...incoming };
  for (const f of userOverrides) {
    if (f === 'enabled') continue;
    merged[f] = existing[f];
  }
  return merged;
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

function fmtChangeValue(v: any): string {
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
}

/**
 * Per-field diff of a route's behaviour-defining content (`ROUTE_FIELDS`). For an array field the
 * `added`/`removed` carry the set difference (by value); for a scalar/object, `added=[after]` and
 * `removed=[before]` (each empty when that side is absent). Unchanged fields are skipped.
 */
export function diffRouteFields(before: any, after: any): RouteFieldChange[] {
  const changes: RouteFieldChange[] = [];
  for (const field of ROUTE_FIELDS) {
    const b = before?.[field];
    const a = after?.[field];
    if (stableStringify(b ?? null) === stableStringify(a ?? null)) continue;
    if (Array.isArray(b) || Array.isArray(a)) {
      const bArr: any[] = Array.isArray(b) ? b : [];
      const aArr: any[] = Array.isArray(a) ? a : [];
      const bKeys = new Set(bArr.map(stableStringify));
      const aKeys = new Set(aArr.map(stableStringify));
      changes.push({
        field,
        added: aArr.filter((x) => !bKeys.has(stableStringify(x))),
        removed: bArr.filter((x) => !aKeys.has(stableStringify(x))),
      });
    } else {
      changes.push({ field, added: a == null ? [] : [a], removed: b == null ? [] : [b] });
    }
  }
  return changes;
}

/** Render a field diff as `field: [+added, -removed], …` (objects JSON-stringified). */
export function renderChanges(changes: RouteFieldChange[]): string {
  return (changes || [])
    .map((c) => `${c.field}: [${[...(c.added || []).map((v) => `+${fmtChangeValue(v)}`), ...(c.removed || []).map((v) => `-${fmtChangeValue(v)}`)].join(', ')}]`)
    .join(', ');
}
