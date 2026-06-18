import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HttpMetric,
  HttpMetricPoint,
  HttpMetricRepository,
  MetricQuery,
  MetricSeriesBucket,
  MetricSeriesQuery,
  TrackCallInput,
} from '@open-rlb/nestjs-amqp';
import { FilterQuery, Model, Types } from 'mongoose';
import { HTTP_METRIC_MODEL, HTTP_METRIC_POINT_MODEL } from '../connections';

@Injectable()
export class MongoHttpMetricRepository extends HttpMetricRepository {
  private readonly logger = new Logger(MongoHttpMetricRepository.name);

  constructor(
    @Inject(HTTP_METRIC_MODEL) private readonly model: Model<any>,
    @Inject(HTTP_METRIC_POINT_MODEL) private readonly pointModel: Model<any>,
  ) {
    super();
  }

  // --- rolling counters (per method+route) -----------------------------------

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
            lastCalledAt: Date.now(),
          },
          $inc: { count: 1, errorCount: isError ? 1 : 0, totalDurationMs: input.durationMs ?? 0 },
        },
        { upsert: true },
      ).exec();
    } catch (error) { this.logger.error(error); throw error; }
  }

  async list(route?: string): Promise<(HttpMetric & { avgDurationMs: number; })[]> {
    try {
      const filter = route ? { route } : {};
      const data = await this.model.find(filter).sort({ count: -1 }).exec();
      return data.map((o: any) => {
        const m = o.toJSON({ flattenMaps: false, transform: (doc: any, ret: any) => { ret._id = doc?._id?.toString(); } }) as HttpMetric;
        return { ...m, avgDurationMs: m.count ? Math.round(m.totalDurationMs / m.count) : 0 };
      });
    } catch (error) { this.logger.error(error); throw error; }
  }

  // --- raw points / time-series ----------------------------------------------

  async record(point: HttpMetricPoint): Promise<void> {
    if (!point?.method || !point?.route) return;
    try {
      await this.pointModel.insertMany([{ ...point, _id: new Types.ObjectId(), ts: point.ts ?? Date.now() }]);
    } catch (error) { this.logger.error(error); throw error; }
  }

  async points(query: MetricQuery): Promise<HttpMetricPoint[]> {
    try {
      const q = this.pointModel.find(this.buildMatch(query)).sort({ ts: -1 });
      if (query.limit) q.limit(query.limit);
      const data = await q.exec();
      return data.map((o: any) => this.toPoint(o));
    } catch (error) { this.logger.error(error); throw error; }
  }

  async series(query: MetricSeriesQuery): Promise<MetricSeriesBucket[]> {
    const width = query.bucketMs > 0 ? query.bucketMs : 60_000;
    try {
      // Bucket by aligning each point's ts down to a multiple of `width`, then aggregate in Mongo.
      const rows = await this.pointModel.aggregate([
        { $match: this.buildMatch(query) },
        {
          $group: {
            _id: { $subtract: ['$ts', { $mod: ['$ts', width] }] },
            count: { $sum: 1 },
            errorCount: { $sum: { $cond: [{ $gte: ['$status', 400] }, 1, 0] } },
            totalDurationMs: { $sum: { $ifNull: ['$durationMs', 0] } },
            minDurationMs: { $min: { $ifNull: ['$durationMs', 0] } },
            maxDurationMs: { $max: { $ifNull: ['$durationMs', 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]).exec();
      return rows.map((r: any) => ({
        bucketStart: r._id,
        count: r.count,
        errorCount: r.errorCount,
        totalDurationMs: r.totalDurationMs,
        avgDurationMs: r.count > 0 ? Math.round(r.totalDurationMs / r.count) : 0,
        minDurationMs: r.minDurationMs,
        maxDurationMs: r.maxDurationMs,
      }));
    } catch (error) { this.logger.error(error); throw error; }
  }

  /** Builds a Mongo filter from a MetricQuery: method/route/name + inclusive [from,to] ts window. */
  private buildMatch(q: MetricQuery): FilterQuery<any> {
    const match: FilterQuery<any> = {};
    if (q.method) match.method = q.method;
    if (q.route) match.route = q.route;
    if (q.name) match.name = q.name;
    if (q.from != null || q.to != null) {
      match.ts = {};
      if (q.from != null) match.ts.$gte = q.from;
      if (q.to != null) match.ts.$lte = q.to;
    }
    return match;
  }

  private toPoint(raw: any): HttpMetricPoint {
    return raw.toJSON({ flattenMaps: false, transform: (doc: any, ret: any) => { ret._id = doc?._id?.toString(); } }) as HttpMetricPoint;
  }
}
