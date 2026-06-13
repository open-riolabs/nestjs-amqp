import { Inject, Injectable, Logger } from '@nestjs/common';
import { HttpMetric, HttpMetricRepository, TrackCallInput } from '@open-rlb/nestjs-amqp';
import { Model, Types } from 'mongoose';
import { HTTP_METRIC_MODEL } from '../connections';

@Injectable()
export class MongoHttpMetricRepository extends HttpMetricRepository {
  private readonly logger = new Logger(MongoHttpMetricRepository.name);

  constructor(@Inject(HTTP_METRIC_MODEL) private readonly model: Model<any>) {
    super();
  }

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
}
