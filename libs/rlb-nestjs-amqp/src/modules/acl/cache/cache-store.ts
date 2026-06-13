/**
 * Pluggable L2 cache backing for the ACL module. The consumer provides an
 * implementation (e.g. wrapping a Redis client) under the RLB_ACL_CACHE_STORE token.
 * When no implementation is provided, the ACL cache runs RAM-only.
 */
export interface AclCacheStore {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(keys: string[]): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}
