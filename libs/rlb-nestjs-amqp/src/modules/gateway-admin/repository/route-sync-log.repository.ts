import { RouteSyncLogEntry } from '../models';

/**
 * Persistent journal of route-sync events (added/updated/removed/collision/...). Implemented by
 * the consuming app. RAM-only impls are fine for examples.
 */
export abstract class RouteSyncLogRepository {
  abstract insert(entry: RouteSyncLogEntry): Promise<RouteSyncLogEntry>;
  abstract list(limit?: number): Promise<RouteSyncLogEntry[]>;
}
