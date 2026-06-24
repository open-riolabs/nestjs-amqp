import { PathDefinition } from '../../proxy/config/path-definition.config';
import { RouteFieldChange } from '../models';
import { StoredHttpPath } from '../repository/http-path.repository';
import { diffRouteFields, isValidRoute, routeContent, routeKeyOf } from './route-manifest';

export interface RouteDiff {
  /** Routes to insert/update for this service. `added` = true when it is a new row; `changes`
   *  is the per-field diff (present on updates only). */
  upserts: { routeKey: string; existingId?: string; added: boolean; model: StoredHttpPath; changes?: RouteFieldChange[] }[];
  /** This service's existing rows no longer in the manifest → soft-disable. */
  disables: { id: string; routeKey: string; method?: string; path?: string }[];
  /** Routes skipped because the routeKey is owned by YAML or another service. */
  collisions: { routeKey: string; method?: string; path?: string; conflictWith: string }[];
  /** Routes left untouched because a user edited them (`modified`): the user's version wins and
   *  the manifest version is ignored. Surfaced so the sync can log them (info). */
  skipped: { routeKey: string; method?: string; path?: string }[];
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
  const diff: RouteDiff = { upserts: [], disables: [], collisions: [], skipped: [], invalid: [], changed: false };
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
    // A user-edited route (modified=true) is locked: the user's version wins, so the manifest never
    // overwrites it. Surface it for an info log instead of upserting.
    if (ex && ex.modified === true) { diff.skipped.push({ routeKey: key, method: r.method, path: r.path }); continue; }
    if (ex && ex.enabled !== false && routeContent(ex) === routeContent(r)) continue; // unchanged
    diff.upserts.push({
      routeKey: key,
      existingId: ex?._id,
      added: !ex,
      model: { ...r, owner: service, routeKey: key, enabled: true, source: 'microservice', modified: false },
      changes: ex ? diffRouteFields(ex, r) : undefined,
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
