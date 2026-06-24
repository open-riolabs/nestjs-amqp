import { Inject, Injectable, Logger } from '@nestjs/common';
import { PaginationModel, RouteSyncLogEntry, RouteSyncLogQuery, RouteSyncLogRepository } from '@open-rlb/nestjs-amqp';
import { FilterQuery, Model, Types } from 'mongoose';
import { ROUTE_SYNC_LOG_MODEL } from '../connections';

/** Mongo-backed journal of route auto-discovery events (newest first). */
@Injectable()
export class MongoRouteSyncLogRepository extends RouteSyncLogRepository {
  private readonly logger = new Logger(MongoRouteSyncLogRepository.name);

  constructor(@Inject(ROUTE_SYNC_LOG_MODEL) private readonly model: Model<any>) {
    super();
  }

  async insert(entry: RouteSyncLogEntry): Promise<RouteSyncLogEntry> {
    try {
      const data = await this.model.insertMany([{ ...entry, _id: new Types.ObjectId() }]);
      return this.toModel(data.find((o: any) => !!o))!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async list(limit = 100): Promise<RouteSyncLogEntry[]> {
    try {
      const data = await this.model.find({}).sort({ ts: -1 }).limit(limit).exec();
      return data.map((o: any) => this.toModel(o)!);
    } catch (error) { this.logger.error(error); throw error; }
  }

  async query(filter: RouteSyncLogQuery, page = 1, limit = 20): Promise<PaginationModel<RouteSyncLogEntry>> {
    try {
      const match: FilterQuery<any> = {};
      if (filter.actor != null) match.actor = filter.actor;
      if (filter.service != null) match.service = filter.service;
      if (filter.event != null) match.event = filter.event;
      if (filter.routeKey != null) match.routeKey = filter.routeKey;
      if (filter.from != null || filter.to != null) {
        match.ts = {};
        if (filter.from != null) match.ts.$gte = filter.from;
        if (filter.to != null) match.ts.$lte = filter.to;
      }
      const p = page && page > 0 ? page : 1;
      const total = await this.model.countDocuments(match).exec();
      const docs = await this.model.find(match).sort({ ts: -1 }).skip((p - 1) * limit).limit(limit).exec();
      return { page: p, limit, total, data: docs.map((o: any) => this.toModel(o)!) };
    } catch (error) { this.logger.error(error); throw error; }
  }

  async prune(olderThanTs: number): Promise<number> {
    try { return (await this.model.deleteMany({ ts: { $lt: olderThanTs } }).exec()).deletedCount ?? 0; }
    catch (error) { this.logger.error(error); throw error; }
  }

  private toModel(raw: any): RouteSyncLogEntry | null | undefined {
    if (!raw) return raw as null | undefined;
    return raw.toJSON({ flattenMaps: false, transform: (doc: any, ret: any) => { ret._id = doc?._id?.toString(); } }) as RouteSyncLogEntry;
  }
}
