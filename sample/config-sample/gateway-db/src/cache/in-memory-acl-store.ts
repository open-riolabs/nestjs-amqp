import { Injectable } from '@nestjs/common';
import { AclCacheStore } from '@open-rlb/nestjs-amqp';

interface Entry { value: string; exp: number; }

/**
 * In-memory L2 ACL cache for the example app. Replaces the private Redis-backed store so
 * the example builds without external/private packages. It implements the same
 * RLB_ACL_CACHE_STORE contract (string '1'/'0' decisions with a TTL) using a plain Map.
 *
 * NOT for production / multi-instance: the map is per-process and not shared, so cache
 * invalidations on one instance won't reach the others. For a real deployment, plug a
 * shared store (Redis, etc.) under RLB_ACL_CACHE_STORE instead.
 */
@Injectable()
export class InMemoryAclStore implements AclCacheStore {
  private readonly store = new Map<string, Entry>();

  async get(key: string): Promise<string | null | undefined> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.exp <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
  }

  async del(keys: string[]): Promise<void> {
    for (const key of keys) this.store.delete(key);
  }

  async keys(pattern: string): Promise<string[]> {
    // AclCacheService only uses simple globs like `acl/<userId>/*` (or `acl/*`).
    const regExp = this.globToRegExp(pattern);
    const out: string[] = [];
    for (const key of this.store.keys()) {
      if (regExp.test(key)) out.push(key);
    }
    return out;
  }

  private globToRegExp(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
  }
}