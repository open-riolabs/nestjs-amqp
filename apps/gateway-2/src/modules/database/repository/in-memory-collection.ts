import { PaginationModel } from '@open-rlb/nestjs-amqp';

let __seq = 0;
/** Monotonic, ObjectId-looking id (24 hex chars) — no randomness needed. */
function nextId(): string {
  return (++__seq).toString(16).padStart(24, '0');
}

/** True when `item` matches a simple filter: field equality and `{ $in: [...] }`. */
function matches(item: any, filter: Record<string, any>): boolean {
  for (const key of Object.keys(filter || {})) {
    const cond = filter[key];
    if (cond === undefined) continue;
    if (cond && typeof cond === 'object' && Array.isArray(cond.$in)) {
      if (!cond.$in.includes(item[key])) return false;
    } else if (item[key] !== cond) {
      return false;
    }
  }
  return true;
}

/**
 * Tiny in-memory collection that mimics the slice of Mongo behavior the repositories
 * need (CRUD by id/filter, `$in`, pagination). Returns shallow copies so callers can't
 * mutate stored documents. Used by the example's RAM repositories instead of Mongoose.
 */
export class InMemoryCollection<T extends { _id?: string }> {
  private readonly items = new Map<string, T>();

  insert(model: T): T {
    const _id = model._id ?? nextId();
    const stored = { ...model, _id } as T;
    this.items.set(_id, stored);
    return { ...stored };
  }

  findById(id: string): T | undefined {
    const v = this.items.get(id);
    return v ? { ...v } : undefined;
  }

  findOne(filter: Record<string, any>): T | undefined {
    for (const v of this.items.values()) if (matches(v, filter)) return { ...v };
    return undefined;
  }

  filter(filter: Record<string, any>): T[] {
    return [...this.items.values()].filter((v) => matches(v, filter)).map((v) => ({ ...v }));
  }

  updateById(id: string, patch: Partial<T>): T | undefined {
    const v = this.items.get(id);
    if (!v) return undefined;
    const next = { ...v, ...patch, _id: id } as T;
    this.items.set(id, next);
    return { ...next };
  }

  updateOne(filter: Record<string, any>, patch: Partial<T>): T | undefined {
    for (const [id, v] of this.items) {
      if (matches(v, filter)) {
        const next = { ...v, ...patch, _id: id } as T;
        this.items.set(id, next);
        return { ...next };
      }
    }
    return undefined;
  }

  removeById(id: string): T | undefined {
    const v = this.items.get(id);
    if (!v) return undefined;
    this.items.delete(id);
    return { ...v };
  }

  removeOne(filter: Record<string, any>): T | undefined {
    for (const [id, v] of this.items) {
      if (matches(v, filter)) {
        this.items.delete(id);
        return { ...v };
      }
    }
    return undefined;
  }

  all(): T[] {
    return [...this.items.values()].map((v) => ({ ...v }));
  }

  paginate(filter: Record<string, any>, page = 1, limit = 10): PaginationModel<T> {
    const data = this.filter(filter);
    const p = page < 1 ? 1 : page;
    const start = (p - 1) * limit;
    return { page: p, limit, total: data.length, data: data.slice(start, start + limit) };
  }
}
