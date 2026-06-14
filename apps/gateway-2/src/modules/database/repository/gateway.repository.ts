import { Injectable } from '@nestjs/common';
import {
  AuthProviderRepository,
  HandlerAuthConfig,
  HttpMetric,
  HttpMetricRepository,
  HttpPathRepository,
  PaginationModel,
  PathDefinition,
  StoredAuthProvider,
  StoredHttpPath,
  TrackCallInput,
} from '@open-rlb/nestjs-amqp';
import { InMemoryCollection } from './in-memory-collection';

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
}

@Injectable()
export class InMemoryAuthProviderRepository extends AuthProviderRepository {
  private readonly col = new InMemoryCollection<StoredAuthProvider>();

  async insert(model: StoredAuthProvider): Promise<StoredAuthProvider> { return this.col.insert(model); }
  async findById(id: string): Promise<StoredAuthProvider> { return this.col.findById(id)!; }
  async findOne(filter: Record<string, any>): Promise<StoredAuthProvider> { return this.col.findOne(filter)!; }
  async updateById(id: string, model: StoredAuthProvider): Promise<StoredAuthProvider> { return this.col.updateById(id, model)!; }
  async removeById(id: string): Promise<StoredAuthProvider> { return this.col.removeById(id)!; }
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
}
