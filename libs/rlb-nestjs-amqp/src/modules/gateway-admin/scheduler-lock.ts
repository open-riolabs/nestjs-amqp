// The DI token lives in ./const (RLB_GW_SCHED_LOCK) to keep all tokens in one place; it is
// re-exported by the module barrel alongside this interface.

/**
 * Optional distributed lock so cluster-wide scheduled jobs (metric rollup, retention pruning) run
 * on ONE instance per tick instead of on every instance. Supply an implementation under the
 * {@link RLB_GW_SCHED_LOCK} token (e.g. backed by Mongo `findOneAndUpdate` with a TTL index, or
 * Redis `SET key val NX PX ttl`). When no implementation is provided the jobs run on every instance
 * — idempotent (rollups upsert by bucket, prunes are deletes) but wasteful under multi-instance.
 */
export interface GatewaySchedulerLock {
  /**
   * Try to acquire `name` for at most `ttlMs`. Returns true if THIS instance now holds it (and so
   * should run the job), false otherwise. The lock MUST auto-expire after `ttlMs` so a crashed
   * holder never blocks the job forever.
   */
  tryAcquire(name: string, ttlMs: number): Promise<boolean>;
  /** Optional early release once the job has finished (before `ttlMs`), freeing the next tick sooner. */
  release?(name: string): Promise<void>;
}

/** Lock names used by the gateway-admin scheduled jobs. */
export const GW_SCHED_LOCK_NAMES = {
  rollup: 'gw-metrics-rollup',
  retention: 'gw-retention',
} as const;
