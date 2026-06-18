import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { GatewayMetricPoint, GatewayMetricsHook } from '@open-rlb/nestjs-amqp';
import { lastValueFrom } from 'rxjs';

/**
 * Example {@link GatewayMetricsHook} that writes each served request straight into InfluxDB (a
 * time-series database), using the v2 write API + line protocol over HTTP — no extra dependency,
 * just the axios-based HttpService. It is a NO-OP until configured, so the example boots fine
 * without an InfluxDB instance. Enable it with env vars:
 *
 *   INFLUX_URL=http://localhost:8086  INFLUX_TOKEN=<token>  INFLUX_ORG=<org>  INFLUX_BUCKET=gateway
 *
 * Query it later with Flux, e.g. requests-per-minute per route:
 *   from(bucket:"gateway") |> range(start:-1h)
 *     |> filter(fn:(r)=> r._measurement=="http_request" and r._field=="count")
 *     |> aggregateWindow(every:1m, fn:sum)
 */
@Injectable()
export class InfluxMetricsHook implements GatewayMetricsHook {
  private readonly logger = new Logger(InfluxMetricsHook.name);
  private readonly url = process.env.INFLUX_URL;
  private readonly token = process.env.INFLUX_TOKEN;
  private readonly org = process.env.INFLUX_ORG;
  private readonly bucket = process.env.INFLUX_BUCKET || 'gateway';

  constructor(private readonly http: HttpService) {
    if (!this.enabled) {
      this.logger.warn('InfluxMetricsHook is a no-op: set INFLUX_URL, INFLUX_TOKEN and INFLUX_ORG (+ optional INFLUX_BUCKET) to enable time-series writes.');
    }
  }

  private get enabled(): boolean {
    return !!(this.url && this.token && this.org);
  }

  async track(point: GatewayMetricPoint): Promise<void> {
    if (!this.enabled) return;
    const writeUrl = `${this.url!.replace(/\/$/, '')}/api/v2/write?org=${encodeURIComponent(this.org!)}&bucket=${encodeURIComponent(this.bucket)}&precision=ns`;
    try {
      await lastValueFrom(this.http.post(writeUrl, this.toLineProtocol(point), {
        headers: { Authorization: `Token ${this.token}`, 'Content-Type': 'text/plain; charset=utf-8' },
        timeout: 4000,
      }));
    } catch (e) {
      this.logger.debug(`influx write failed: ${(e as Error)?.message}`);
    }
  }

  /** measurement `http_request`, tags=method/route/status/mode/action, fields=duration_ms+count, ns ts. */
  private toLineProtocol(p: GatewayMetricPoint): string {
    const tags = [
      `method=${this.escapeTag(p.method)}`,
      `route=${this.escapeTag(p.route)}`,
      p.status != null ? `status=${p.status}` : undefined,
      p.mode ? `mode=${this.escapeTag(p.mode)}` : undefined,
      p.action ? `action=${this.escapeTag(p.action)}` : undefined,
    ].filter(Boolean).join(',');
    const fields = `duration_ms=${p.durationMs ?? 0},count=1i`;
    const tsNs = `${p.ts}000000`; // ms → ns
    return `http_request,${tags} ${fields} ${tsNs}`;
  }

  /** Influx line-protocol tag values must escape commas, spaces and equals signs. */
  private escapeTag(v: any): string {
    return String(v ?? '').replace(/[ ,=]/g, '\\$&');
  }
}
