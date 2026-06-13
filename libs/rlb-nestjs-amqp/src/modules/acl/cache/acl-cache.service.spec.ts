import { AclModuleOptions } from '../config/acl.config';
import { AclCacheService } from './acl-cache.service';
import { AclCacheStore } from './cache-store';

class FakeStore implements AclCacheStore {
  readonly map = new Map<string, string>();
  getCalls = 0;
  async get(key: string) { this.getCalls++; return this.map.get(key) ?? null; }
  async set(key: string, value: string) { this.map.set(key, value); }
  async del(keys: string[]) { keys.forEach((k) => this.map.delete(k)); }
  async keys(pattern: string) {
    const prefix = pattern.replace(/\*$/, '');
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

const opts: AclModuleOptions = { cache: { ramTtlMs: 1000, l2TtlSec: 60 } };

describe('AclCacheService', () => {
  it('returns null on a cold miss', async () => {
    const svc = new AclCacheService(opts);
    expect(await svc.get('u', 't', 'a')).toBeNull();
  });

  it('serves from RAM after set (RAM-only, no L2)', async () => {
    const svc = new AclCacheService(opts);
    await svc.set('u', 't', 'a', true);
    expect(await svc.get('u', 't', 'a')).toBe(true);
  });

  it('writes to L2 and repopulates RAM from L2 on a RAM miss', async () => {
    const store = new FakeStore();
    const svc = new AclCacheService(opts, store);
    await svc.set('u', 't', 'a', true);
    expect(store.map.get('acl/u/t/a')).toBe('1');
    svc.invalidateLocalRam(); // drop RAM, keep L2
    const before = store.getCalls;
    expect(await svc.get('u', 't', 'a')).toBe(true); // read from L2
    expect(store.getCalls).toBe(before + 1);
    // now served from RAM (no extra L2 read)
    expect(await svc.get('u', 't', 'a')).toBe(true);
    expect(store.getCalls).toBe(before + 1);
  });

  it('caches a false decision distinctly from a miss', async () => {
    const store = new FakeStore();
    const svc = new AclCacheService(opts, store);
    await svc.set('u', 't', 'a', false);
    svc.invalidateLocalRam();
    expect(await svc.get('u', 't', 'a')).toBe(false);
  });

  it('invalidate(userId) clears RAM and L2 so the next read is a miss', async () => {
    const store = new FakeStore();
    const svc = new AclCacheService(opts, store);
    await svc.set('u', 't', 'a', true);
    await svc.invalidate('u');
    expect(store.map.size).toBe(0);
    expect(await svc.get('u', 't', 'a')).toBeNull();
  });

  it('respects RAM TTL expiry', async () => {
    const svc = new AclCacheService({ cache: { ramTtlMs: -1 } });
    await svc.set('u', 't', 'a', true);
    expect(await svc.get('u', 't', 'a')).toBeNull();
  });
});
