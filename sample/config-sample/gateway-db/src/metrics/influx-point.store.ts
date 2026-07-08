import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpMetricPoint, MetricQuery } from '@open-rlb/nestjs-amqp';
import { lastValueFrom } from 'rxjs';

interface InfluxConfig { url?: string; token?: string; org?: string; orgID?: string; bucket?: string; }

const MEASUREMENT = 'http_metric_point';
const FLUSH_MS = 1000;
const MAX_BATCH = 500;      // flush early once the buffer reaches this many points
const MAX_BUFFER = 20_000;  // hard backpressure cap: never grow the buffer past this (drop instead)

/**
 * Stores the raw per-request metric POINTS in InfluxDB instead of Mongo, so the high-volume
 * `http-metric-point` workload stays OFF the application database. The rolling counters
 * (`http-metric`) and the hourly rollups (`http-metric-rollup`) remain in Mongo.
 *
 * Backs the three point operations the {@link HttpMetricRepository} needs — record / query / prune —
 * over Influx's v2 HTTP API (write line-protocol, query Flux, delete-by-predicate), reusing the axios
 * HttpService (no extra dependency), exactly like InfluxMetricsHook. Config from the `influx:` block in
 * config.yaml. NO-OP (safe) until influx.url/token/org are set.
 *
 * Writes are BATCHED (buffered, flushed every second) so `record()` never blocks the request path and
 * Influx sees ~1 request/second instead of one per HTTP call. Each point gets a unique ns timestamp
 * (ms + a sequence) so coincident same-tag requests are not deduped by line protocol.
 */
@Injectable()
export class InfluxPointStore implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InfluxPointStore.name);
  private readonly cfg: InfluxConfig;
  private readonly bucket: string;
  private buffer: string[] = [];
  private seq = 0;
  private dropped = 0;
  private flushing = false;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly http: HttpService, config: ConfigService) {
    this.cfg = config.get<InfluxConfig>('influx') ?? {};
    this.bucket = this.cfg.bucket || 'gateway';
    if (!this.enabled) {
      this.logger.warn('InfluxPointStore is a no-op: set influx.url, influx.token and influx.org (or influx.orgID) in config.yaml to store metric points.');
    }
  }

  private get enabled(): boolean { return !!(this.cfg.url && this.cfg.token && (this.cfg.org || this.cfg.orgID)); }
  private url(path: string): string { return `${this.cfg.url!.replace(/\/$/, '')}${path}`; }
  private get auth(): Record<string, string> { return { Authorization: `Token ${this.cfg.token}` }; }
  /** Influx accepts the org by NAME (`org`) or by ID (`orgID`) — prefer the ID when given (stable). */
  private orgParam(): string { return this.cfg.orgID ? `orgID=${encodeURIComponent(this.cfg.orgID)}` : `org=${encodeURIComponent(this.cfg.org ?? '')}`; }

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  // --- write (batched, non-blocking) ----------------------------------------
  record(point: HttpMetricPoint): void {
    if (!this.enabled || !point?.method || !point?.route) return;
    // Backpressure: if Influx is down/slow and the buffer is full, DROP the point rather than grow
    // memory. Metrics are best-effort and must never affect the gateway.
    if (this.buffer.length >= MAX_BUFFER) { this.dropped++; return; }
    this.buffer.push(this.toLineProtocol(point));
    if (this.buffer.length >= MAX_BATCH) void this.flush();
  }

  private async flush(): Promise<void> {
    // `flushing` guard: never run overlapping flushes — a slow/hung POST must not pile up in-flight.
    if (!this.enabled || this.flushing || !this.buffer.length) return;
    this.flushing = true;
    const lines = this.buffer;
    this.buffer = [];
    if (this.dropped) {
      this.logger.warn(`influx backpressure: dropped ${this.dropped} point(s) while the buffer was full`);
      this.dropped = 0;
    }
    try {
      await lastValueFrom(this.http.post(
        this.url(`/api/v2/write?${this.orgParam()}&bucket=${encodeURIComponent(this.bucket)}&precision=ns`),
        lines.join('\n'),
        { headers: { ...this.auth, 'Content-Type': 'text/plain; charset=utf-8' }, timeout: 5000 },
      ));
    } catch (e) {
      this.logger.debug(`influx write failed (${lines.length} point(s) dropped): ${(e as Error)?.message}`);
    } finally {
      this.flushing = false;
    }
  }

  private toLineProtocol(p: HttpMetricPoint): string {
    const tags = [
      `method=${this.tag(p.method)}`,
      `route=${this.tag(p.route)}`,
      p.name ? `name=${this.tag(p.name)}` : undefined,
      p.topic ? `topic=${this.tag(p.topic)}` : undefined,
      p.action ? `action=${this.tag(p.action)}` : undefined,
      p.mode ? `mode=${this.tag(p.mode)}` : undefined,
    ].filter(Boolean).join(',');
    const fields = [
      `durationMs=${Math.round(p.durationMs ?? 0)}i`,
      p.status != null ? `status=${Math.round(p.status)}i` : undefined,
      p.code ? `code="${this.str(p.code)}"` : undefined,
      'count=1i',
    ].filter(Boolean).join(',');
    const tsNs = `${p.ts ?? Date.now()}${String((this.seq = (this.seq + 1) % 1_000_000)).padStart(6, '0')}`;
    return `${MEASUREMENT},${tags} ${fields} ${tsNs}`;
  }

  // --- query (returns raw points, same shape as the Mongo impl) --------------
  async query(q: MetricQuery): Promise<HttpMetricPoint[]> {
    if (!this.enabled) return [];
    try {
      const resp = await lastValueFrom(this.http.post(
        this.url(`/api/v2/query?${this.orgParam()}`),
        this.buildFlux(q),
        { headers: { ...this.auth, 'Content-Type': 'application/vnd.flux', Accept: 'application/csv' }, timeout: 30000, responseType: 'text' },
      ));
      return this.parseCsv(String(resp.data));
    } catch (e) {
      this.logger.error(`influx query failed: ${(e as Error)?.message}`);
      return [];
    }
  }

  private buildFlux(q: MetricQuery): string {
    const start = q.from != null ? new Date(q.from).toISOString() : '-90d';
    const stop = q.to != null ? new Date(q.to).toISOString() : 'now()';
    const filters = [
      `r._measurement == "${MEASUREMENT}"`,
      q.method ? `r.method == "${this.str(q.method)}"` : undefined,
      q.route ? `r.route == "${this.str(q.route)}"` : undefined,
      q.name ? `r.name == "${this.str(q.name)}"` : undefined,
    ].filter(Boolean).join(' and ');
    const limit = q.limit && q.limit > 0 ? `\n  |> limit(n: ${Math.floor(q.limit)})` : '';
    return [
      `from(bucket: "${this.str(this.bucket)}")`,
      `  |> range(start: ${start}, stop: ${stop})`,
      `  |> filter(fn: (r) => ${filters})`,
      '  |> filter(fn: (r) => r._field == "status" or r._field == "durationMs" or r._field == "code")',
      '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")',
      `  |> sort(columns: ["_time"], desc: true)${limit}`,
    ].join('\n');
  }

  // --- prune (the daily retention job calls this with now - retentionDays) ---
  async prune(olderThanTs: number): Promise<number> {
    if (!this.enabled) return 0;
    try {
      await lastValueFrom(this.http.post(
        this.url(`/api/v2/delete?${this.orgParam()}&bucket=${encodeURIComponent(this.bucket)}`),
        { start: '1970-01-01T00:00:00Z', stop: new Date(olderThanTs).toISOString(), predicate: `_measurement="${MEASUREMENT}"` },
        { headers: { ...this.auth, 'Content-Type': 'application/json' }, timeout: 15000 },
      ));
    } catch (e) {
      this.logger.warn(`influx prune failed: ${(e as Error)?.message}`);
    }
    return 0; // Influx delete API returns no count.
  }

  // --- helpers ---------------------------------------------------------------
  /** Line-protocol tag value: escape comma, space and equals. */
  private tag(v: any): string { return String(v ?? '').replace(/[ ,=]/g, '\\$&'); }
  /** Quoted string value (Flux filter / line-protocol string field): escape backslash and quote. */
  private str(v: any): string { return String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

  /** Parse Influx annotated CSV into points. Handles multiple tables (#annotation block + header + rows). */
  private parseCsv(csv: string): HttpMetricPoint[] {
    const out: HttpMetricPoint[] = [];
    let header: string[] | null = null;
    let expectHeader = false;
    for (const raw of csv.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim()) { header = null; expectHeader = false; continue; }
      if (line.startsWith('#')) { expectHeader = true; continue; }
      const cells = this.splitCsv(line);
      if (expectHeader || !header) { header = cells; expectHeader = false; continue; }
      const row: Record<string, string> = {};
      header.forEach((h, i) => (row[h] = cells[i]));
      const ts = Date.parse(row['_time']);
      if (Number.isNaN(ts)) continue;
      out.push({
        ts,
        method: row['method'],
        route: row['route'],
        name: row['name'] || undefined,
        topic: row['topic'] || undefined,
        action: row['action'] || undefined,
        mode: row['mode'] || undefined,
        status: row['status'] ? Number(row['status']) : undefined,
        durationMs: row['durationMs'] ? Number(row['durationMs']) : undefined,
        code: row['code'] || undefined,
      } as HttpMetricPoint);
    }
    return out;
  }

  /** Minimal RFC-4180 CSV line split (handles double-quoted fields with "" escapes). */
  private splitCsv(line: string): string[] {
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  }
}
