import { Injectable } from '@nestjs/common';
import {
  AuthProviderRepository,
  HandlerAuthConfig,
  HttpMetric,
  HttpMetricPoint,
  HttpMetricRepository,
  HttpMetricRollup,
  HttpPathRepository,
  MetricQuery,
  MetricSeriesQuery,
  PaginationModel,
  PathDefinition,
  StoredAuthProvider,
  StoredHttpPath,
  TrackCallInput,
} from '@open-rlb/nestjs-amqp';
import { InMemoryCollection } from './in-memory-collection';

/** True when a metric point matches the query's method/route/name + [from,to] time window. */
function matchPoint(p: HttpMetricPoint, q: MetricQuery): boolean {
  if (q.method && p.method !== q.method) return false;
  if (q.route && p.route !== q.route) return false;
  if (q.name && p.name !== q.name) return false;
  if (q.from != null && p.ts < q.from) return false;
  if (q.to != null && p.ts > q.to) return false;
  return true;
}

/** Drops persistence-only fields (_id, enabled) from a stored doc. */
function toPlain<T extends { _id?: string; enabled?: boolean }>(doc: T): Omit<T, '_id' | 'enabled'> {
  const { _id, enabled, ...rest } = doc;
  return rest;
}

@Injectable()
export class InMemoryHttpPathRepository extends HttpPathRepository {
  private readonly col = new InMemoryCollection<StoredHttpPath>();

  async insert(model: StoredHttpPath): Promise<StoredHttpPath> { return this.col.insert(model); }
  async findById(id: string): Promise<StoredHttpPath> { return this.col.findById(id)!; }
  async findOne(filter: Record<string, any>): Promise<StoredHttpPath> { return this.col.findOne(filter)!; }
  async updateById(id: string, model: StoredHttpPath): Promise<StoredHttpPath> { return this.col.updateById(id, model)!; }
  async removeById(id: string): Promise<StoredHttpPath> { return this.col.removeById(id)!; }
  async filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<StoredHttpPath>> {
    return this.col.paginate(filter, Number(page) || 1, Number(limit) || 10);
  }

  async listEnabled(): Promise<PathDefinition[]> {
    return this.col.all()
      .filter((p) => p.enabled !== false)
      .map((p) => toPlain(p) as PathDefinition);
  }

  async filter(filter: Record<string, any>): Promise<StoredHttpPath[]> {
    return this.col.filter(filter);
  }

  async search(q?: string, page?: number, limit?: number): Promise<PaginationModel<StoredHttpPath>> {
    return this.col.search(q, Number(page) || 1, Number(limit) || 10);
  }
}

@Injectable()
export class InMemoryAuthProviderRepository extends AuthProviderRepository {
  private readonly col = new InMemoryCollection<StoredAuthProvider & { _id?: string }>();

  async insert(model: StoredAuthProvider): Promise<StoredAuthProvider> { return this.col.insert(model); }
  async findByName(name: string): Promise<StoredAuthProvider> { return this.col.findOne({ name })!; }
  async findOne(filter: Record<string, any>): Promise<StoredAuthProvider> { return this.col.findOne(filter)!; }
  async upsertByName(name: string, model: StoredAuthProvider): Promise<StoredAuthProvider> { return this.col.upsertOne({ name }, model); }
  async removeByName(name: string): Promise<StoredAuthProvider> { return this.col.removeOne({ name })!; }
  async filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<StoredAuthProvider>> {
    return this.col.paginate(filter, Number(page) || 1, Number(limit) || 10);
  }

  async listEnabled(): Promise<HandlerAuthConfig[]> {
    return this.col.all()
      .filter((p) => p.enabled !== false)
      .map((p) => toPlain(p) as HandlerAuthConfig);
  }

  async search(q?: string, page?: number, limit?: number): Promise<PaginationModel<StoredAuthProvider>> {
    return this.col.search(q, Number(page) || 1, Number(limit) || 10);
  }
}

@Injectable()
export class InMemoryHttpMetricRepository extends HttpMetricRepository {
  private readonly col = new InMemoryCollection<HttpMetric>();
  private readonly pointsCol = new InMemoryCollection<HttpMetricPoint>();
  private readonly rollupCol = new InMemoryCollection<HttpMetricRollup>();

  async increment(input: TrackCallInput): Promise<void> {
    if (!input?.method || !input?.route) return;
    const existing = this.col.findOne({ method: input.method, route: input.route });
    const isError = (input.status ?? 0) >= 400;
    if (!existing) {
      this.col.insert({
        method: input.method,
        route: input.route,
        name: input.name,
        topic: input.topic,
        action: input.action,
        count: 1,
        errorCount: isError ? 1 : 0,
        lastStatus: input.status,
        lastCalledAt: Date.now(),
        totalDurationMs: input.durationMs || 0,
        lastErrorCode: isError ? input.code : undefined,
      });
      return;
    }
    this.col.updateById(existing._id!, {
      name: input.name ?? existing.name,
      topic: input.topic ?? existing.topic,
      action: input.action ?? existing.action,
      count: existing.count + 1,
      errorCount: existing.errorCount + (isError ? 1 : 0),
      lastStatus: input.status,
      lastCalledAt: Date.now(),
      totalDurationMs: existing.totalDurationMs + (input.durationMs || 0),
      lastErrorCode: isError ? input.code : existing.lastErrorCode,
    });
  }

  async list(route?: string): Promise<(HttpMetric & { avgDurationMs: number; errorRate: number; })[]> {
    const rows = route ? this.col.filter({ route }) : this.col.all();
    return rows.map((m) => ({
      ...m,
      avgDurationMs: m.count > 0 ? Math.round(m.totalDurationMs / m.count) : 0,
      errorRate: m.count ? m.errorCount / m.count : 0,
    }));
  }

  async record(point: HttpMetricPoint): Promise<void> {
    if (!point?.method || !point?.route) return;
    this.pointsCol.insert({ ...point, ts: point.ts ?? Date.now() });
  }

  async points(query: MetricQuery): Promise<HttpMetricPoint[]> {
    const rows = this.pointsCol.all().filter((p) => matchPoint(p, query)).sort((a, b) => b.ts - a.ts);
    return query.limit ? rows.slice(0, query.limit) : rows;
  }

  async recordRollups(rollups: HttpMetricRollup[]): Promise<void> {
    for (const r of rollups || []) {
      // Idempotent upsert keyed by (bucketStart, granularityMs, method, route).
      this.rollupCol.removeMany({ bucketStart: r.bucketStart, granularityMs: r.granularityMs, method: r.method, route: r.route });
      this.rollupCol.insert({ ...r });
    }
  }

  async rollupSeries(query: MetricSeriesQuery): Promise<HttpMetricRollup[]> {
    return this.rollupCol.all()
      .filter((r) => {
        if (query.from != null && r.bucketStart < query.from) return false;
        if (query.to != null && r.bucketStart > query.to) return false;
        if (query.method && r.method !== query.method) return false;
        if (query.route && r.route !== query.route) return false;
        if (query.name && r.name !== query.name) return false;
        return true;
      })
      .sort((a, b) => a.bucketStart - b.bucketStart);
  }

  async pruneRollups(olderThanTs: number): Promise<number> {
    const stale = this.rollupCol.all().filter((r) => (r.bucketStart ?? 0) < olderThanTs);
    for (const r of stale) this.rollupCol.removeById((r as any)._id);
    return stale.length;
  }

  async prunePoints(olderThanTs: number): Promise<number> {
    const stale = this.pointsCol.all().filter((p) => (p.ts ?? 0) < olderThanTs);
    for (const p of stale) this.pointsCol.removeById((p as any)._id);
    return stale.length;
  }
}
