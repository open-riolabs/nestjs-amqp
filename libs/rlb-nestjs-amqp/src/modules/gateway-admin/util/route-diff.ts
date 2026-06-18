import { PathDefinition } from '../../proxy/config/path-definition.config';
import { StoredHttpPath } from '../repository/http-path.repository';
import { isValidRoute, routeContent, routeKeyOf } from './route-manifest';

export interface RouteDiff {
  /** Routes to insert/update for this service. `added` = true when it is a new row. */
  upserts: { routeKey: string; existingId?: string; added: boolean; model: StoredHttpPath }[];
  /** This service's existing rows no longer in the manifest → soft-disable. */
  disables: { id: string; routeKey: string; method?: string; path?: string }[];
  /** Routes skipped because the routeKey is owned by YAML or another service. */
  collisions: { routeKey: string; method?: string; path?: string; conflictWith: string }[];
  /** Malformed routes that were dropped. */
  invalid: { route: any }[];
  changed: boolean;
}

/**
 * Pure diff of an incoming manifest against THIS service's existing DB rows. Route identity is
 * `(method, path)` (the gateway's routing key); a route is "changed" when its content differs
 * (compared via `routeContent`, key-order-independent).
 *
 * @param reserved routeKeys owned by YAML or OTHER services, mapped to that owner. Must NOT
 *                 contain this service's own keys (those are updates, not collisions).
 */
export function diffRoutes(
  service: string,
  incoming: PathDefinition[],
  existing: StoredHttpPath[],
  reserved: Map<string, string>,
): RouteDiff {
  const diff: RouteDiff = { upserts: [], disables: [], collisions: [], invalid: [], changed: false };
  const existingByKey = new Map<string, StoredHttpPath>();
  for (const e of existing || []) if (e.routeKey) existingByKey.set(e.routeKey, e);
  const seen = new Set<string>();

  for (const r of incoming || []) {
    if (!isValidRoute(r)) { diff.invalid.push({ route: r }); continue; }
    const key = routeKeyOf(r);                  // identity = METHOD + path
    if (seen.has(key)) continue;                // duplicate within the manifest → first wins
    seen.add(key);

    const owner = reserved.get(key);
    if (owner && owner !== service) {
      diff.collisions.push({ routeKey: key, method: r.method, path: r.path, conflictWith: owner });
      continue;
    }

    const ex = existingByKey.get(key);
    if (ex && ex.enabled !== false && routeContent(ex) === routeContent(r)) continue; // unchanged
    diff.upserts.push({
      routeKey: key,
      existingId: ex?._id,
      added: !ex,
      model: { ...r, owner: service, routeKey: key, enabled: true },
    });
  }

  for (const [key, ex] of existingByKey) {
    if (!seen.has(key) && ex.enabled !== false) {
      diff.disables.push({ id: ex._id!, routeKey: key, method: ex.method, path: ex.path });
    }
  }

  diff.changed = diff.upserts.length > 0 || diff.disables.length > 0;
  return diff;
}
