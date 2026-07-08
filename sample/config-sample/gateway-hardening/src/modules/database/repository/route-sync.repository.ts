import { Injectable } from '@nestjs/common';
import { PaginationModel, RouteSyncLogEntry, RouteSyncLogQuery, RouteSyncLogRepository } from '@open-rlb/nestjs-amqp';
import { InMemoryCollection } from './in-memory-collection';

/** In-RAM journal collection for route-sync events (added/updated/removed/collision/...). */
@Injectable()
export class InMemoryRouteSyncLogRepository extends RouteSyncLogRepository {
  private readonly col = new InMemoryCollection<RouteSyncLogEntry>();

  async insert(entry: RouteSyncLogEntry): Promise<RouteSyncLogEntry> { return this.col.insert(entry); }
  async list(limit = 100): Promise<RouteSyncLogEntry[]> {
    return this.col.all().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, limit);
  }

  async query(filter: RouteSyncLogQuery, page = 1, limit = 20): Promise<PaginationModel<RouteSyncLogEntry>> {
    const rows = this.col.all()
      .filter((r) => {
        if (filter.actor != null && r.actor !== filter.actor) return false;
        if (filter.service != null && r.service !== filter.service) return false;
        if (filter.event != null && r.event !== filter.event) return false;
        if (filter.routeKey != null && r.routeKey !== filter.routeKey) return false;
        if (filter.from != null && (r.ts || 0) < filter.from) return false;
        if (filter.to != null && (r.ts || 0) > filter.to) return false;
        return true;
      })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const p = page < 1 ? 1 : page;
    const start = (p - 1) * limit;
    return { page: p, limit, total: rows.length, data: rows.slice(start, start + limit) };
  }

  async prune(olderThanTs: number): Promise<number> {
    const stale = this.col.all().filter((r) => (r.ts || 0) < olderThanTs);
    for (const r of stale) this.col.removeById((r as any)._id);
    return stale.length;
  }
}
