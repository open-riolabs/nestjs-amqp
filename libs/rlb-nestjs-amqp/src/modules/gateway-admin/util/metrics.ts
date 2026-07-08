import { HttpMetric, HttpMetricPoint, HttpMetricRollup, MetricSeriesBucket, MetricSeriesQuery, MetricStatusClass, MetricStatusClasses, MetricSummary, MetricTopEntry } from '../models';

/** The HTTP status class of a status code, or undefined when absent/unknown. */
export function statusClass(status?: number): MetricStatusClass | undefined {
  if (status == null) return undefined;
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return undefined;
}

/** Nearest-rank percentile (p in 0..100) over an ascending-sorted number array. */
export function percentile(sortedAsc: number[], p: number): number | undefined {
  if (!sortedAsc.length) return undefined;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx];
}

function emptyStatusClasses(): MetricStatusClasses {
  return { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
}

/** Build enriched time-series buckets (count/errors/avg|min|max + p50/p95/p99 + byStatus) from raw points. */
export function buildSeries(points: HttpMetricPoint[], query: MetricSeriesQuery): MetricSeriesBucket[] {
  const width = query.bucketMs > 0 ? query.bucketMs : 60_000;
  const buckets = new Map<number, { durations: number[]; count: number; errorCount: number; total: number; min?: number; max?: number; byStatus: MetricStatusClasses }>();
  for (const p of points || []) {
    const start = Math.floor(p.ts / width) * width;
    let b = buckets.get(start);
    if (!b) { b = { durations: [], count: 0, errorCount: 0, total: 0, byStatus: emptyStatusClasses() }; buckets.set(start, b); }
    b.count++;
    if ((p.status ?? 0) >= 400) b.errorCount++;
    const d = p.durationMs ?? 0;
    b.total += d; b.durations.push(d);
    b.min = b.min == null ? d : Math.min(b.min, d);
    b.max = b.max == null ? d : Math.max(b.max, d);
    const sc = statusClass(p.status);
    if (sc) b.byStatus[sc]++;
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([bucketStart, b]) => {
    const sorted = b.durations.sort((x, y) => x - y);
    return {
      bucketStart,
      count: b.count,
      errorCount: b.errorCount,
      totalDurationMs: b.total,
      avgDurationMs: b.count ? Math.round(b.total / b.count) : 0,
      minDurationMs: b.min,
      maxDurationMs: b.max,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      byStatus: b.byStatus,
    };
  });
}

/** Dashboard overview from raw points: totals, percentiles, status breakdown, and top-N routes
 *  (by traffic, by errors, by p95 latency). */
export function buildSummary(points: HttpMetricPoint[], topN = 10): MetricSummary {
  const byStatus = emptyStatusClasses();
  const durations: number[] = [];
  let total = 0;
  let errors = 0;
  const per = new Map<string, { method: string; route: string; name?: string; count: number; errorCount: number; total: number; durations: number[] }>();
  for (const p of points || []) {
    const d = p.durationMs ?? 0;
    durations.push(d);
    total += d;
    const isError = (p.status ?? 0) >= 400;
    if (isError) errors++;
    const sc = statusClass(p.status);
    if (sc) byStatus[sc]++;
    const key = `${p.method} ${p.route}`;
    let e = per.get(key);
    if (!e) { e = { method: p.method, route: p.route, name: p.name, count: 0, errorCount: 0, total: 0, durations: [] }; per.set(key, e); }
    e.count++; e.total += d; e.durations.push(d);
    if (isError) e.errorCount++;
  }
  const n = points?.length || 0;
  const sortedAll = durations.sort((a, b) => a - b);
  const entries: MetricTopEntry[] = [...per.values()].map((e) => {
    const sorted = e.durations.sort((a, b) => a - b);
    return {
      method: e.method, route: e.route, name: e.name,
      count: e.count, errorCount: e.errorCount,
      errorRate: e.count ? e.errorCount / e.count : 0,
      avgDurationMs: e.count ? Math.round(e.total / e.count) : 0,
      p95: percentile(sorted, 95),
    };
  });
  const top = (cmp: (a: MetricTopEntry, b: MetricTopEntry) => number) => [...entries].sort(cmp).slice(0, topN);
  return {
    totalRequests: n,
    totalErrors: errors,
    errorRate: n ? errors / n : 0,
    avgDurationMs: n ? Math.round(total / n) : 0,
    p50: percentile(sortedAll, 50),
    p95: percentile(sortedAll, 95),
    p99: percentile(sortedAll, 99),
    byStatus,
    topByTraffic: top((a, b) => b.count - a.count),
    topByErrors: top((a, b) => (b.errorCount - a.errorCount) || (b.errorRate - a.errorRate)),
    topByLatency: top((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0)),
  };
}

/** Downsample raw points into per-(bucket, method, route) rollups at `granularityMs` (e.g. 1h). */
export function aggregateRollups(points: HttpMetricPoint[], granularityMs: number): HttpMetricRollup[] {
  const g = granularityMs > 0 ? granularityMs : 3_600_000;
  const rollups = new Map<string, HttpMetricRollup>();
  for (const p of points || []) {
    const bucketStart = Math.floor(p.ts / g) * g;
    const key = `${bucketStart}|${p.method}|${p.route}`;
    let r = rollups.get(key);
    if (!r) { r = { bucketStart, granularityMs: g, method: p.method, route: p.route, name: p.name, count: 0, errorCount: 0, totalDurationMs: 0, byStatus: emptyStatusClasses() }; rollups.set(key, r); }
    r.count++;
    if ((p.status ?? 0) >= 400) r.errorCount++;
    const d = p.durationMs ?? 0;
    r.totalDurationMs += d;
    r.minDurationMs = r.minDurationMs == null ? d : Math.min(r.minDurationMs, d);
    r.maxDurationMs = r.maxDurationMs == null ? d : Math.max(r.maxDurationMs, d);
    const sc = statusClass(p.status);
    if (sc && r.byStatus) r.byStatus[sc]++;
  }
  return [...rollups.values()];
}

function escapeLabel(value: unknown): string {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/** Prometheus text exposition (v0.0.4) of the rolling counters. Percentiles need histograms and are
 *  intentionally NOT emitted here — use gw-metrics-summary/series for distribution stats. */
export function toPrometheus(counters: (HttpMetric & { avgDurationMs: number; errorRate?: number })[]): string {
  const labels = (m: HttpMetric) => `method="${escapeLabel(m.method)}",route="${escapeLabel(m.route)}"${m.name ? `,name="${escapeLabel(m.name)}"` : ''}`;
  const lines: string[] = [];
  lines.push('# HELP gateway_requests_total Total HTTP requests handled by the gateway.');
  lines.push('# TYPE gateway_requests_total counter');
  for (const m of counters || []) lines.push(`gateway_requests_total{${labels(m)}} ${m.count}`);
  lines.push('# HELP gateway_request_errors_total Error responses (status >= 400).');
  lines.push('# TYPE gateway_request_errors_total counter');
  for (const m of counters || []) lines.push(`gateway_request_errors_total{${labels(m)}} ${m.errorCount}`);
  lines.push('# HELP gateway_request_duration_ms_sum Total request duration in milliseconds.');
  lines.push('# TYPE gateway_request_duration_ms_sum counter');
  for (const m of counters || []) lines.push(`gateway_request_duration_ms_sum{${labels(m)}} ${m.totalDurationMs}`);
  return lines.join('\n') + '\n';
}
