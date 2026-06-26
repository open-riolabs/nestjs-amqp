import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HttpMetric,
  HttpMetricPoint,
  HttpMetricRepository,
  HttpMetricRollup,
  MetricQuery,
  MetricSeriesQuery,
  TrackCallInput,
} from '@open-rlb/nestjs-amqp';
import { FilterQuery, Model, Types } from 'mongoose';
import { InfluxPointStore } from '../../../metrics/influx-point.store';
import { HTTP_METRIC_MODEL, METRIC_ROLLUP_MODEL } from '../connections';

/**
 * Hybrid metrics store: rolling counters (`http-metric`) and hourly rollups (`http-metric-rollup`)
 * live in Mongo; the high-volume raw POINTS are delegated to {@link InfluxPointStore} (InfluxDB) so
 * they stay off the application DB. The HttpMetricRepository contract is unchanged, so the gateway
 * service / AMQP actions / HTTP routes are identical — only the points backend moved.
 */
@Injectable()
export class MongoHttpMetricRepository extends HttpMetricRepository {
  private readonly logger = new Logger(MongoHttpMetricRepository.name);

  constructor(
    @Inject(HTTP_METRIC_MODEL) private readonly model: Model<any>,
    @Inject(METRIC_ROLLUP_MODEL) private readonly rollupModel: Model<any>,
    private readonly pointStore: InfluxPointStore,
  ) {
    super();
  }

  // --- rolling counters (per method+route) — Mongo ---------------------------

  async increment(input: TrackCallInput): Promise<void> {
    const isError = (input.status ?? 0) >= 400;
    try {
      await this.model.updateOne(
        { method: input.method, route: input.route },
        {
          $setOnInsert: { _id: new Types.ObjectId(), method: input.method, route: input.route },
          $set: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.topic !== undefined ? { topic: input.topic } : {}),
            ...(input.action !== undefined ? { action: input.action } : {}),
            ...(input.status !== undefined ? { lastStatus: input.status } : {}),
            // On an error response, record the error code; on success leave the prior value untouched.
            ...(isError ? { lastErrorCode: input.code } : {}),
            lastCalledAt: Date.now(),
          },
          $inc: { count: 1, errorCount: isError ? 1 : 0, totalDurationMs: input.durationMs ?? 0 },
        },
        { upsert: true },
      ).exec();
    } catch (error) { this.logger.error(error); throw error; }
  }

  async list(route?: string): Promise<(HttpMetric & { avgDurationMs: number; errorRate: number; })[]> {
    try {
      const filter = route ? { route } : {};
      const data = await this.model.find(filter).sort({ count: -1 }).exec();
      return data.map((o: any) => {
        const m = o.toJSON({ flattenMaps: false, transform: (doc: any, ret: any) => { ret._id = doc?._id?.toString(); } }) as HttpMetric;
        return {
          ...m,
          avgDurationMs: m.count ? Math.round(m.totalDurationMs / m.count) : 0,
          errorRate: m.count ? m.errorCount / m.count : 0,
        };
      });
    } catch (error) { this.logger.error(error); throw error; }
  }

  // --- raw points — InfluxDB -------------------------------------------------

  async record(point: HttpMetricPoint): Promise<void> {
    this.pointStore.record(point); // buffered, non-blocking
  }

  async points(query: MetricQuery): Promise<HttpMetricPoint[]> {
    return this.pointStore.query(query);
  }

  async prunePoints(olderThanTs: number): Promise<number> {
    return this.pointStore.prune(olderThanTs);
  }

  // --- rollups (downsampled long-term aggregates) — Mongo --------------------

  async recordRollups(rollups: HttpMetricRollup[]): Promise<void> {
    if (!rollups?.length) return;
    try {
      // Idempotent upsert per (bucketStart, granularityMs, method, route).
      await this.rollupModel.bulkWrite(rollups.map((r) => ({
        updateOne: {
          filter: { bucketStart: r.bucketStart, granularityMs: r.granularityMs, method: r.method, route: r.route },
          update: {
            $setOnInsert: { _id: new Types.ObjectId() },
            $set: {
              bucketStart: r.bucketStart,
              granularityMs: r.granularityMs,
              ...(r.method !== undefined ? { method: r.method } : {}),
              ...(r.route !== undefined ? { route: r.route } : {}),
              ...(r.name !== undefined ? { name: r.name } : {}),
              count: r.count,
              errorCount: r.errorCount,
              totalDurationMs: r.totalDurationMs,
              ...(r.minDurationMs !== undefined ? { minDurationMs: r.minDurationMs } : {}),
              ...(r.maxDurationMs !== undefined ? { maxDurationMs: r.maxDurationMs } : {}),
              ...(r.byStatus !== undefined ? { byStatus: r.byStatus } : {}),
            },
          },
          upsert: true,
        },
      })));
    } catch (error) { this.logger.error(error); throw error; }
  }

  async rollupSeries(query: MetricSeriesQuery): Promise<HttpMetricRollup[]> {
    try {
      const data = await this.rollupModel.find(this.buildRollupMatch(query)).sort({ bucketStart: 1 }).exec();
      return data.map((o: any) => this.toRollup(o));
    } catch (error) { this.logger.error(error); throw error; }
  }

  async pruneRollups(olderThanTs: number): Promise<number> {
    try { return (await this.rollupModel.deleteMany({ bucketStart: { $lt: olderThanTs } }).exec()).deletedCount ?? 0; }
    catch (error) { this.logger.error(error); throw error; }
  }

  /** Builds a rollup filter from a MetricSeriesQuery: method/route/name + inclusive [from,to] on bucketStart. */
  private buildRollupMatch(q: MetricSeriesQuery): FilterQuery<any> {
    const match: FilterQuery<any> = {};
    if (q.method) match.method = q.method;
    if (q.route) match.route = q.route;
    if (q.name) match.name = q.name;
    if (q.from != null || q.to != null) {
      match.bucketStart = {};
      if (q.from != null) match.bucketStart.$gte = q.from;
      if (q.to != null) match.bucketStart.$lte = q.to;
    }
    return match;
  }

  private toRollup(raw: any): HttpMetricRollup {
    return raw.toJSON({ flattenMaps: false, transform: (doc: any, ret: any) => { ret._id = doc?._id?.toString(); } }) as HttpMetricRollup;
  }
}
