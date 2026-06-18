import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayMetricPoint, GatewayMetricsHook } from '@open-rlb/nestjs-amqp';
import { lastValueFrom } from 'rxjs';

/** InfluxDB connection settings, read from the same place as everything else (config.yaml → `influx`). */
interface InfluxConfig {
  url?: string;
  token?: string;
  org?: string;
  bucket?: string;
}

/**
 * {@link GatewayMetricsHook} that writes each served request straight into InfluxDB (a time-series
 * database), using the v2 write API + line protocol over HTTP — no extra dependency, just the
 * axios-based HttpService. Runs ONCE per served request, independently of the broker-based
 * `gateway.metrics` sink (both can be active).
 *
 * Configuration comes from the YAML config (`influx:` block), like every other setting — no env
 * vars. It is a NO-OP until url/token/org are filled in, so the gateway boots fine without InfluxDB.
 *
 * Query it later with Flux, e.g. requests-per-minute per route:
 *   from(bucket:"gateway") |> range(start:-1h)
 *     |> filter(fn:(r)=> r._measurement=="http_request" and r._field=="count")
 *     |> aggregateWindow(every:1m, fn:sum)
 */
@Injectable()
export class InfluxMetricsHook implements GatewayMetricsHook {
  private readonly logger = new Logger(InfluxMetricsHook.name);
  private readonly cfg: InfluxConfig;
  private readonly bucket: string;

  constructor(private readonly http: HttpService, config: ConfigService) {
    this.cfg = config.get<InfluxConfig>('influx') ?? {};
    this.bucket = this.cfg.bucket || 'gateway';
    if (!this.enabled) {
      this.logger.warn('InfluxMetricsHook is a no-op: set influx.url, influx.token and influx.org (+ optional influx.bucket) in config.yaml to enable time-series writes.');
    }
  }

  private get enabled(): boolean {
    return !!(this.cfg.url && this.cfg.token && this.cfg.org);
  }

  async track(point: GatewayMetricPoint): Promise<void> {
    if (!this.enabled) return;
    const writeUrl = `${this.cfg.url!.replace(/\/$/, '')}/api/v2/write?org=${encodeURIComponent(this.cfg.org!)}&bucket=${encodeURIComponent(this.bucket)}&precision=ns`;
    try {
      await lastValueFrom(this.http.post(writeUrl, this.toLineProtocol(point), {
        headers: { Authorization: `Token ${this.cfg.token}`, 'Content-Type': 'text/plain; charset=utf-8' },
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
