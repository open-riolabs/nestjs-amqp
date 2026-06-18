import { Injectable } from '@nestjs/common';
import { RouteSyncLogEntry, RouteSyncLogRepository } from '@open-rlb/nestjs-amqp';
import { InMemoryCollection } from './in-memory-collection';

/** In-RAM journal collection for route-sync events (added/updated/removed/collision/...). */
@Injectable()
export class InMemoryRouteSyncLogRepository extends RouteSyncLogRepository {
  private readonly col = new InMemoryCollection<RouteSyncLogEntry>();

  async insert(entry: RouteSyncLogEntry): Promise<RouteSyncLogEntry> { return this.col.insert(entry); }
  async list(limit = 100): Promise<RouteSyncLogEntry[]> {
    // newest first
    return this.col.all().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, limit);
  }
}
