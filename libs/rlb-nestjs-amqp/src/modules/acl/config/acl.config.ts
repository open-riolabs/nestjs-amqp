export interface AclCacheOptions {
  /** L1 (RAM) entry lifetime in ms. Default 30000. */
  ramTtlMs?: number;
  /** L2 (pluggable store) entry lifetime in seconds. Default 600. */
  l2TtlSec?: number;
}

export interface AclModuleOptions {
  cache?: AclCacheOptions;
  /** Broker topic to bind handlers to (default ACL_TOPIC = 'rlb-acl'). */
  topic?: string;
}
