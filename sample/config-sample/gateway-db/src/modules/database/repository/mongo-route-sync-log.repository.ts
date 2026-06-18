import { Inject, Injectable, Logger } from '@nestjs/common';
import { RouteSyncLogEntry, RouteSyncLogRepository } from '@open-rlb/nestjs-amqp';
import { Model, Types } from 'mongoose';
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

  private toModel(raw: any): RouteSyncLogEntry | null | undefined {
    if (!raw) return raw as null | undefined;
    return raw.toJSON({ flattenMaps: false, transform: (doc: any, ret: any) => { ret._id = doc?._id?.toString(); } }) as RouteSyncLogEntry;
  }
}
