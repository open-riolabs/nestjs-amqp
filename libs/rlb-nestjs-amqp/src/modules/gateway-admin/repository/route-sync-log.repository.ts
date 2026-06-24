import { PaginationModel } from '../../../common';
import { RouteSyncLogEntry, RouteSyncLogQuery } from '../models';

/**
 * Persistent journal of route-change events (auto-discovery + user CRUD). Implemented by the
 * consuming app. RAM-only impls are fine for examples.
 */
export abstract class RouteSyncLogRepository {
  abstract insert(entry: RouteSyncLogEntry): Promise<RouteSyncLogEntry>;
  abstract list(limit?: number): Promise<RouteSyncLogEntry[]>;
  /** Filtered + paginated query over the journal (newest first). All filter fields optional. */
  abstract query(filter: RouteSyncLogQuery, page?: number, limit?: number): Promise<PaginationModel<RouteSyncLogEntry>>;
  /** Delete entries older than `olderThanTs` (epoch ms); returns the number removed. Retention. */
  abstract prune(olderThanTs: number): Promise<number>;
}
