import { Injectable } from '@nestjs/common';
import {
  AuthProviderRepository,
  HandlerAuthConfig,
  HttpMetric,
  HttpMetricPoint,
  HttpMetricRepository,
  HttpPathRepository,
  MetricQuery,
  MetricSeriesBucket,
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
}

@Injectable()
export class InMemoryAuthProviderRepository extends AuthProviderRepository {
  // Storage keeps an internal _id (the collection's key); the public StoredAuthProvider has none.
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
}

@Injectable()
export class InMemoryHttpMetricRepository extends HttpMetricRepository {
  private readonly col = new InMemoryCollection<HttpMetric>();
  private readonly pointsCol = new InMemoryCollection<HttpMetricPoint>();

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
    });
  }

  async list(route?: string): Promise<(HttpMetric & { avgDurationMs: number; })[]> {
    const rows = route ? this.col.filter({ route }) : this.col.all();
    return rows.map((m) => ({ ...m, avgDurationMs: m.count > 0 ? Math.round(m.totalDurationMs / m.count) : 0 }));
  }

  async record(point: HttpMetricPoint): Promise<void> {
    if (!point?.method || !point?.route) return;
    this.pointsCol.insert({ ...point, ts: point.ts ?? Date.now() });
  }

  async points(query: MetricQuery): Promise<HttpMetricPoint[]> {
    const rows = this.pointsCol.all().filter((p) => matchPoint(p, query)).sort((a, b) => b.ts - a.ts);
    return query.limit ? rows.slice(0, query.limit) : rows;
  }

  async series(query: MetricSeriesQuery): Promise<MetricSeriesBucket[]> {
    const width = query.bucketMs > 0 ? query.bucketMs : 60_000;
    const buckets = new Map<number, MetricSeriesBucket>();
    for (const p of this.pointsCol.all()) {
      if (!matchPoint(p, query)) continue;
      const start = Math.floor(p.ts / width) * width;
      let b = buckets.get(start);
      if (!b) { b = { bucketStart: start, count: 0, errorCount: 0, totalDurationMs: 0, avgDurationMs: 0 }; buckets.set(start, b); }
      b.count++;
      if ((p.status ?? 0) >= 400) b.errorCount++;
      const d = p.durationMs ?? 0;
      b.totalDurationMs += d;
      b.minDurationMs = b.minDurationMs == null ? d : Math.min(b.minDurationMs, d);
      b.maxDurationMs = b.maxDurationMs == null ? d : Math.max(b.maxDurationMs, d);
    }
    const out = [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart);
    for (const b of out) b.avgDurationMs = b.count > 0 ? Math.round(b.totalDurationMs / b.count) : 0;
    return out;
  }
}
