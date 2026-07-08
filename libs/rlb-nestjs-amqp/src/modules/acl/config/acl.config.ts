export interface AclCacheOptions {
  /** L1 (RAM) entry lifetime in ms. Default 30000. */
  ramTtlMs?: number;
  /** L2 (pluggable store) entry lifetime in seconds. Default 600. */
  l2TtlSec?: number;
  /**
   * Hard cap on the number of L1 (RAM) entries. When exceeded, the oldest entries are evicted
   * (insertion order) so a high `(userId × scope × actionset)` cardinality cannot grow the cache
   * without bound. Default 50000; set 0/negative to disable the cap (unbounded — not recommended).
   */
  maxRamEntries?: number;
}

/**
 * Optional cross-instance ACL cache invalidation over AMQP. Without it, after a grant/revoke each
 * OTHER gateway/service instance keeps serving its L1 (RAM) decisions until they expire (`ramTtlMs`).
 * When set, the mutating instance broadcasts an invalidation so peers flush their local RAM at once.
 * The `exchange` MUST be declared in the app's `broker.exchanges` (typically a `fanout`); every
 * instance binds an ephemeral, per-instance queue to it. No-op when this is omitted.
 */
export interface AclInvalidationOptions {
  exchange: string;
  /** Routing key for the broadcast (default 'acl-invalidate'; ignored by fanout exchanges). */
  routingKey?: string;
}

export interface AclModuleOptions {
  cache?: AclCacheOptions;
  /** Action a caller must hold (on the target company/resource) before they may grant or
   *  revoke. Defaults to `'role-management'` (ACL_DEFAULT_ROLE_MANAGEMENT_ACTION). */
  roleManagementAction?: string;
  /**
   * SYSTEM-level override action for grant/revoke. Checked resource-AGNOSTICALLY: a caller who holds
   * it (typically via a global grant with no company/resource) may grant or revoke on ANY resource,
   * bypassing the per-resource `roleManagementAction` check. Use it to bootstrap the first owner on a
   * freshly created resource that has no grants yet. Defaults to `'role-system'`
   * (ACL_DEFAULT_ROLE_SYSTEM_ACTION). Grant it only to trusted system administrators.
   */
  roleSystemAction?: string;
  /** Cross-instance L1 cache invalidation over AMQP. Omit to keep RAM-local invalidation only. */
  invalidation?: AclInvalidationOptions;
  /**
   * Deadline in ms for the DB resolution inside a cache-miss `checkAction` (roles + grants reads).
   * Default 5000. On timeout the check REJECTS (throws) so the gateway fails closed with 503 instead
   * of blocking the request indefinitely on a stalled ACL DB (head-of-line blocking under load).
   * Set 0/negative to disable the deadline (unbounded wait — the previous behaviour). Cache HITS are
   * never affected (no DB read). Keep it well above normal DB latency so it only trips on a genuine stall.
   */
  checkTimeoutMs?: number;
}
