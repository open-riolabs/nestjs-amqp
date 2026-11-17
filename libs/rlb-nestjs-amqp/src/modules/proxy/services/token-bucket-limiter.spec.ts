import { TokenBucketLimiter } from './token-bucket-limiter';

describe('TokenBucketLimiter', () => {
  let now: number;
  const clock = () => now;
  beforeEach(() => { now = 1_000_000; });

  it('lets a burst through, then one request per 1/rate seconds', () => {
    const l = new TokenBucketLimiter(100, clock);
    const rule = { requestsPerSecond: 1, burst: 3 };
    expect([1, 2, 3].map(() => l.take('k', rule).allowed)).toEqual([true, true, true]);
    expect(l.take('k', rule)).toMatchObject({ allowed: false, retryAfterSec: 1 });
    now += 999;
    expect(l.take('k', rule).allowed).toBe(false);
    now += 1;
    expect(l.take('k', rule).allowed).toBe(true);
    expect(l.take('k', rule).allowed).toBe(false);
  });

  it('refills up to the burst, never above it', () => {
    const l = new TokenBucketLimiter(100, clock);
    const rule = { requestsPerSecond: 2, burst: 4 };
    for (let i = 0; i < 4; i++) l.take('k', rule);
    now += 60_000; // a minute idle: would be 120 tokens without the cap
    const passed = Array.from({ length: 10 }, () => l.take('k', rule).allowed).filter(Boolean).length;
    expect(passed).toBe(4);
  });

  it('the incident shape: 16 req/s against 1 req/s burst 5 lets ~1 req/s through after the burst', () => {
    const l = new TokenBucketLimiter(100, clock);
    const rule = { requestsPerSecond: 1, burst: 5 };
    let passed = 0;
    for (let i = 0; i < 16 * 60; i++) { // one minute at 16 req/s
      if (l.take('k', rule).allowed) passed++;
      now += 62.5;
    }
    expect(passed).toBeGreaterThanOrEqual(64); // 5 burst + 60 refilled (±1 at the edge)
    expect(passed).toBeLessThanOrEqual(65);
  });

  it('Retry-After is the wait for one token, rounded up, at least 1 s', () => {
    const l = new TokenBucketLimiter(100, clock);
    l.take('slow', { requestsPerSecond: 0.2, burst: 1 });
    expect(l.take('slow', { requestsPerSecond: 0.2, burst: 1 }).retryAfterSec).toBe(5);
    l.take('fast', { requestsPerSecond: 10, burst: 1 });
    expect(l.take('fast', { requestsPerSecond: 10, burst: 1 }).retryAfterSec).toBe(1);
  });

  it('keys are independent', () => {
    const l = new TokenBucketLimiter(100, clock);
    const rule = { requestsPerSecond: 1, burst: 1 };
    expect(l.take('a', rule).allowed).toBe(true);
    expect(l.take('a', rule).allowed).toBe(false);
    expect(l.take('b', rule).allowed).toBe(true);
  });

  it('a clock going back refills nothing', () => {
    const l = new TokenBucketLimiter(100, clock);
    const rule = { requestsPerSecond: 1, burst: 1 };
    l.take('k', rule);
    now -= 10_000;
    expect(l.take('k', rule).allowed).toBe(false);
  });

  it('drops the least recently used bucket past maxKeys', () => {
    const l = new TokenBucketLimiter(2, clock);
    const rule = { requestsPerSecond: 1, burst: 1 };
    l.take('a', rule);
    l.take('b', rule);
    l.take('a', rule); // a is now the most recent (and rejected)
    l.take('c', rule); // evicts b
    expect(l.size).toBe(2);
    expect(l.take('a', rule).allowed).toBe(false); // still remembered
    expect(l.take('b', rule).allowed).toBe(true); // forgotten ⇒ full bucket
  });

  it('sweeps the buckets that have refilled completely, at most once per interval', () => {
    const l = new TokenBucketLimiter(100, clock, 60_000, 60_000);
    l.take('idle', { requestsPerSecond: 1, burst: 2 });
    l.take('busy', { requestsPerSecond: 0.001, burst: 1 }); // refills in 1000 s
    now += 30_000;
    l.take('other', { requestsPerSecond: 1, burst: 1 });
    expect(l.size).toBe(3); // too early for a sweep
    now += 30_000;
    l.take('other', { requestsPerSecond: 1, burst: 1 });
    expect(l.size).toBe(2); // 'idle' was full again; 'busy' still owes tokens
  });

  it('reports rejections at most once per interval per key, with their count', () => {
    const l = new TokenBucketLimiter(100, clock, 60_000);
    const rule = { requestsPerSecond: 0.01, burst: 1 };
    l.take('k', rule);
    expect(l.take('k', rule).rejectionsToReport).toBe(1); // first rejection: reported at once
    for (let i = 0; i < 9; i++) expect(l.take('k', rule).rejectionsToReport).toBeUndefined();
    now += 60_000;
    expect(l.take('k', rule).rejectionsToReport).toBe(10); // the 9 held back + this one
  });
});
