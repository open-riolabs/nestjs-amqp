import { Injectable } from '@nestjs/common';
import { AclCacheStore } from '@open-rlb/nestjs-amqp';

interface Entry { value: string; exp: number; }

/**
 * In-memory L2 ACL cache (RLB_ACL_CACHE_STORE) for this example. A plain per-process Map, so it is
 * NOT shared across instances by itself — which is precisely why this sample also wires the
 * cross-instance invalidation BROADCAST (see AppModule + config.yaml): the broadcast flushes every
 * instance's L1 RAM after a grant/revoke. For production use a shared store (Redis) here so the L2
 * tier is coherent too.
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
