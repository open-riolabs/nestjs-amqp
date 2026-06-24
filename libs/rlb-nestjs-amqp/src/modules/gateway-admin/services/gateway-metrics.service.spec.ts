import { GatewayMetricsService } from './gateway-metrics.service';

function makeRepo(over: Partial<Record<string, unknown>> = {}): any {
  return {
    increment: jest.fn(async () => undefined),
    record: jest.fn(async () => undefined),
    list: jest.fn(async () => []),
    points: jest.fn(async () => []),
    recordRollups: jest.fn(async () => undefined),
    rollupSeries: jest.fn(async () => []),
    pruneRollups: jest.fn(async () => 0),
    prunePoints: jest.fn(async () => 0),
    ...over,
  };
}

describe('GatewayMetricsService', () => {
  it('track increments + records, propagating the error code', async () => {
    const repo = makeRepo();
    await new GatewayMetricsService(repo).track({ method: 'GET', route: '/x', status: 500, code: 'NotFoundError', durationMs: 5 } as any);
    expect(repo.increment).toHaveBeenCalledWith(expect.objectContaining({ code: 'NotFoundError' }));
    expect(repo.record).toHaveBeenCalledWith(expect.objectContaining({ code: 'NotFoundError', status: 500 }));
  });

  it('track ignores input without method/route', async () => {
    const repo = makeRepo();
    await new GatewayMetricsService(repo).track({ route: '/x' } as any);
    expect(repo.increment).not.toHaveBeenCalled();
  });

  it('series is computed app-side from points (percentiles + byStatus)', async () => {
    const repo = makeRepo({ points: jest.fn(async () => [
      { ts: 0, method: 'GET', route: '/x', status: 200, durationMs: 10 },
      { ts: 0, method: 'GET', route: '/x', status: 500, durationMs: 30 },
    ]) });
    const out = await new GatewayMetricsService(repo).series(60_000);
    expect(repo.points).toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ count: 2, errorCount: 1, p50: 10, byStatus: { '2xx': 1, '3xx': 0, '4xx': 0, '5xx': 1 } });
  });

  it('summary is computed from points', async () => {
    const repo = makeRepo({ points: jest.fn(async () => [
      { ts: 1, method: 'GET', route: '/a', status: 200, durationMs: 10 },
      { ts: 2, method: 'GET', route: '/a', status: 500, durationMs: 20 },
    ]) });
    const s = await new GatewayMetricsService(repo).summary();
    expect(s.totalRequests).toBe(2);
    expect(s.totalErrors).toBe(1);
    expect(s.topByTraffic[0].route).toBe('/a');
  });

  it('prometheus renders the counters', async () => {
    const repo = makeRepo({ list: jest.fn(async () => [{ method: 'GET', route: '/x', count: 3, errorCount: 0, totalDurationMs: 30, avgDurationMs: 10, errorRate: 0 }]) });
    const txt = await new GatewayMetricsService(repo).prometheus();
    expect(txt).toContain('gateway_requests_total{method="GET",route="/x"} 3');
  });

  it('rollups delegates to rollupSeries', async () => {
    const repo = makeRepo({ rollupSeries: jest.fn(async () => [{ bucketStart: 0, granularityMs: 3_600_000, count: 1, errorCount: 0, totalDurationMs: 5 }]) });
    const out = await new GatewayMetricsService(repo).rollups(3_600_000);
    expect(repo.rollupSeries).toHaveBeenCalled();
    expect(out).toHaveLength(1);
  });
});
