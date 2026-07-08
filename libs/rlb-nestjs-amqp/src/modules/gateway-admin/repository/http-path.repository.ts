import { PaginationModel } from '../../../common';
import { PathDefinition } from '../../proxy/config/path-definition.config';

export type StoredHttpPath = Partial<PathDefinition> & {
  _id?: string;
  enabled?: boolean;
  /** Owning service id for routes published via route auto-discovery (null/absent for
   *  manually-managed rows). The route-sync only ever touches rows of the same owner. */
  owner?: string;
  /** Stable identity `METHOD path` — used by route-sync for upsert/diff. */
  routeKey?: string;
  /** How the route was created: 'microservice' (route auto-discovery) or 'user' (manual admin CRUD). */
  source?: 'microservice' | 'user';
  /** Set true once a user edits a HARD field. Route auto-discovery then SKIPS the whole route (the
   *  user's version wins) instead of overwriting, and logs it (info). Only meaningful for
   *  'microservice' routes. */
  modified?: boolean;
  /** Soft per-field user overrides: the subset of USER_OVERRIDABLE_FIELDS (enabled, actions,
   *  allowAnonymous, timeout, redirect, successStatusCode) the user changed via the admin WITHOUT
   *  locking the route. Route auto-discovery preserves these fields' values while still updating
   *  every other field. Released per-field by passing `releaseOverrides` to gw-path-update. */
  userOverrides?: string[];
};

/**
 * Repository contract for stored HTTP gateway paths. Implemented by the consuming app.
 *
 * routeKey uniqueness: the app-level collision checks in route-sync / gateway-path are find-then-
 * write and therefore racy across instances. The implementation MUST enforce a unique constraint on
 * `routeKey` (e.g. a unique DB index) and surface a violation from `insert`/`updateById` as a
 * `ConflictError` (from the lib's common errors). route-sync catches it to reconcile same-owner vs
 * cross-owner races; gateway-path lets it bubble as a 409.
 */
export abstract class HttpPathRepository {
  /** @throws ConflictError if `routeKey` already exists (unique-constraint violation). */
  abstract insert(model: StoredHttpPath): Promise<StoredHttpPath>;
  abstract findById(id: string): Promise<StoredHttpPath>;
  abstract findOne(filter: Record<string, any>): Promise<StoredHttpPath>;
  /** @throws ConflictError if the update would collide with another row's `routeKey`. */
  abstract updateById(id: string, model: StoredHttpPath): Promise<StoredHttpPath>;
  abstract removeById(id: string): Promise<StoredHttpPath>;
  /** Enabled paths mapped to plain PathDefinition objects (no _id/enabled). */
  abstract listEnabled(): Promise<PathDefinition[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<StoredHttpPath>>;
  /** Simple (unpaginated) list by filter — mirrors the other repositories' `filter`. */
  abstract filter(filter: Record<string, any>): Promise<StoredHttpPath[]>;
  abstract search(q?: string, page?: number, limit?: number): Promise<PaginationModel<StoredHttpPath>>;

  /** All rows owned by `owner` (route auto-discovery). Concrete default over `filter`. */
  findByOwner(owner: string): Promise<StoredHttpPath[]> {
    return this.filter({ owner });
  }

  /** All rows matching this routeKey, in ANY enabled state (used for cross-owner collision
   *  detection — a soft-disabled route still belongs to its owner). Concrete default over `filter`. */
  findByRouteKey(routeKey: string): Promise<StoredHttpPath[]> {
    return this.filter({ routeKey });
  }
}
