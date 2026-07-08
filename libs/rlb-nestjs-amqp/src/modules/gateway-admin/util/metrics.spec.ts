import { buildSeries, buildSummary, percentile, statusClass, toPrometheus } from './metrics';

describe('metrics util', () => {
  it('statusClass maps codes to classes', () => {
    expect(statusClass(204)).toBe('2xx');
    expect(statusClass(301)).toBe('3xx');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(500)).toBe('5xx');
    expect(statusClass(undefined)).toBeUndefined();
  });

  it('percentile (nearest-rank)', () => {
    const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(s, 50)).toBe(50);
    expect(percentile(s, 95)).toBe(100);
    expect(percentile([], 50)).toBeUndefined();
  });

  it('buildSeries buckets with percentiles + byStatus', () => {
    const pts = [
      { ts: 0, method: 'GET', route: '/x', status: 200, durationMs: 10 },
      { ts: 100, method: 'GET', route: '/x', status: 500, durationMs: 30 },
      { ts: 70_000, method: 'GET', route: '/x', status: 200, durationMs: 20 },
    ] as any;
    const out = buildSeries(pts, { bucketMs: 60_000 } as any);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ bucketStart: 0, count: 2, errorCount: 1, p50: 10, byStatus: { '2xx': 1, '3xx': 0, '4xx': 0, '5xx': 1 } });
    expect(out[1]).toMatchObject({ bucketStart: 60_000, count: 1 });
  });

  it('buildSummary: totals, error rate, status breakdown, top-N', () => {
    const pts = [
      { ts: 1, method: 'GET', route: '/a', status: 200, durationMs: 10 },
      { ts: 2, method: 'GET', route: '/a', status: 500, durationMs: 50 },
      { ts: 3, method: 'POST', route: '/b', status: 200, durationMs: 5 },
    ] as any;
    const s = buildSummary(pts, 5);
    expect(s).toMatchObject({ totalRequests: 3, totalErrors: 1 });
    expect(s.errorRate).toBeCloseTo(1 / 3);
    expect(s.byStatus).toEqual({ '2xx': 2, '3xx': 0, '4xx': 0, '5xx': 1 });
    expect(s.topByTraffic[0].route).toBe('/a');   // 2 hits
    expect(s.topByErrors[0].route).toBe('/a');    // the only errors
  });

  it('toPrometheus emits counter exposition', () => {
    const out = toPrometheus([{ method: 'GET', route: '/x', count: 5, errorCount: 1, totalDurationMs: 100, avgDurationMs: 20, errorRate: 0.2 } as any]);
    expect(out).toContain('gateway_requests_total{method="GET",route="/x"} 5');
    expect(out).toContain('gateway_request_errors_total{method="GET",route="/x"} 1');
    expect(out).toContain('# TYPE gateway_requests_total counter');
  });
});
