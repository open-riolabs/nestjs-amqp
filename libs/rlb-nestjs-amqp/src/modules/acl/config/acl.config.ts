export interface AclCacheOptions {
  /** L1 (RAM) entry lifetime in ms. Default 30000. */
  ramTtlMs?: number;
  /** L2 (pluggable store) entry lifetime in seconds. Default 600. */
  l2TtlSec?: number;
}

export interface AclModuleOptions {
  cache?: AclCacheOptions;
}
