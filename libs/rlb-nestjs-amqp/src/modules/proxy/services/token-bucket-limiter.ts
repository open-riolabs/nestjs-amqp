/** The bucket shape the limiter needs (see ResolvedRateLimitRule). */
export interface TokenBucketRule {
  requestsPerSecond: number;
  burst: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** When rejected: whole seconds until the next request would pass (≥ 1), for `Retry-After`. */
  retryAfterSec: number;
  /** Set on a rejection when it is time to log it: the rejections for this key since the last report,
   *  this one included. Keeps a client that is hammering a route to one log line per interval. */
  rejectionsToReport?: number;
}

interface Bucket {
  tokens: number;
  /** Last refill (ms). */
  at: number;
  /** When the bucket is full again if nothing else arrives: past that, dropping it changes nothing. */
  fullAt: number;
  rejected: number;
  reportedAt: number;
}

/**
 * In-memory token buckets, one per key. Bounded: past `maxKeys` the least recently used bucket is
 * dropped (a Map keeps insertion order; a used key is moved to the end), and buckets that have
 * refilled completely are swept at most once per `sweepEveryMs`. Dropping a bucket only forgets a
 * caller that is within its limit, or the oldest one under memory pressure: it never blocks anybody.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep: number;

  constructor(
    private readonly maxKeys: number,
    private readonly now: () => number = Date.now,
    private readonly reportEveryMs = 60_000,
    private readonly sweepEveryMs = 60_000,
  ) {
    this.lastSweep = this.now();
  }

  /** Buckets currently held. */
  get size(): number {
    return this.buckets.size;
  }

  /** Takes one token from `key`'s bucket. */
  take(key: string, rule: TokenBucketRule): RateLimitDecision {
    const now = this.now();
    this.sweep(now);

    let bucket = this.buckets.get(key);
    if (bucket) {
      this.buckets.delete(key); // re-inserted below: the Map's first key is the least recently used
      const elapsedSec = Math.max(0, now - bucket.at) / 1000; // a clock going back refills nothing
      bucket.tokens = Math.min(rule.burst, bucket.tokens + elapsedSec * rule.requestsPerSecond);
      bucket.at = now;
    } else {
      bucket = { tokens: rule.burst, at: now, fullAt: now, rejected: 0, reportedAt: -Infinity };
    }
    this.buckets.set(key, bucket);
    if (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value);

    const allowed = bucket.tokens >= 1;
    if (allowed) bucket.tokens -= 1;
    bucket.fullAt = now + ((rule.burst - bucket.tokens) / rule.requestsPerSecond) * 1000;
    if (allowed) return { allowed: true, retryAfterSec: 0 };

    bucket.rejected++;
    const decision: RateLimitDecision = {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((1 - bucket.tokens) / rule.requestsPerSecond)),
    };
    if (now - bucket.reportedAt >= this.reportEveryMs) {
      decision.rejectionsToReport = bucket.rejected;
      bucket.rejected = 0;
      bucket.reportedAt = now;
    }
    return decision;
  }

  private sweep(now: number) {
    if (now - this.lastSweep < this.sweepEveryMs) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.fullAt <= now) this.buckets.delete(key);
    }
  }
}
