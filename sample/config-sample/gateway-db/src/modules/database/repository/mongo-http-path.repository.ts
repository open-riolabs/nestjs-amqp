import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConflictError, flattenObject, HttpPathRepository, PaginationModel, PathDefinition, StoredHttpPath } from '@open-rlb/nestjs-amqp';
import { FilterQuery, Model, Types } from 'mongoose';
import { HTTP_PATH_MODEL } from '../connections';

@Injectable()
export class MongoHttpPathRepository extends HttpPathRepository {
  private readonly logger = new Logger(MongoHttpPathRepository.name);

  constructor(@Inject(HTTP_PATH_MODEL) private readonly model: Model<any>) {
    super();
  }

  /** True for a Mongo duplicate-key error (unique index violation), incl. the bulk-write shape. */
  private isDuplicateKey(error: any): boolean {
    return error?.code === 11000 || (error?.writeErrors || []).some((w: any) => w?.code === 11000 || w?.err?.code === 11000);
  }

  async insert(model: StoredHttpPath): Promise<StoredHttpPath> {
    try {
      const data = await this.model.insertMany([{ ...model, _id: new Types.ObjectId() }]);
      return this.toModel(data.find((o: any) => !!o))!;
    } catch (error) {
      // Map the unique-routeKey violation to ConflictError so route-sync reconciles the insert race
      // (and manual create returns 409) instead of surfacing a raw MongoError.
      if (this.isDuplicateKey(error)) throw new ConflictError(`A route with this identity already exists (routeKey '${(model as any)?.routeKey}').`);
      this.logger.error(error); throw error;
    }
  }

  async findById(id: string): Promise<StoredHttpPath> {
    try { return this.toModel(await this.model.findById(new Types.ObjectId(id)).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async findOne(filter: FilterQuery<any>): Promise<StoredHttpPath> {
    try { return this.toModel(await this.model.findOne(filter).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async updateById(id: string, model: StoredHttpPath): Promise<StoredHttpPath> {
    try {
      const data = await this.model.findOneAndUpdate({ _id: new Types.ObjectId(id) }, { $set: flattenObject(model) }, { new: true }).exec();
      return this.toModel(data)!;
    } catch (error) {
      // A concurrent update that would collide the routeKey trips the unique index too — surface it
      // as ConflictError for consistent handling with insert.
      if (this.isDuplicateKey(error)) throw new ConflictError(`A route with this identity already exists (routeKey '${(model as any)?.routeKey}').`);
      this.logger.error(error); throw error;
    }
  }

  async removeById(id: string): Promise<StoredHttpPath> {
    try { return this.toModel(await this.model.findOneAndDelete({ _id: new Types.ObjectId(id) }).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async listEnabled(): Promise<PathDefinition[]> {
    try {
      const data = await this.model.find({ enabled: { $ne: false } }).exec();
      return data.map((o: any) => this.toPathDefinition(o));
    } catch (error) { this.logger.error(error); throw error; }
  }

  async filterPaginated(filter: FilterQuery<any>, page?: number, limit?: number): Promise<PaginationModel<StoredHttpPath>> {
    Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
    let data: StoredHttpPath[] = [];
    try {
      const total = await this.model.countDocuments(filter).exec();
      if (total) {
        const query = this.model.find(filter);
        if (limit) { if (!page || page < 1) page = 1; query.skip((page - 1) * limit).limit(limit); }
        else query.limit(1000);
        data = (await query.exec()).map((o: any) => this.toModel(o)!);
      }
      return { page: page!, limit: limit!, total, data };
    } catch (error) { this.logger.error(error); throw error; }
  }

  async filter(filter: FilterQuery<any>): Promise<StoredHttpPath[]> {
    try {
      Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
      const data = await this.model.find(filter).exec();
      return data.map((o: any) => this.toModel(o)!);
    } catch (error) { this.logger.error(error); throw error; }
  }

  async search(q?: string, page = 1, limit = 10): Promise<PaginationModel<StoredHttpPath>> {
    try {
      const fields = ['name', 'method', 'path', 'topic', 'action', 'routeKey', 'owner', 'source'];
      const filter: FilterQuery<any> = q ? { $or: fields.map((f) => ({ [f]: { $regex: q, $options: 'i' } })) } : {};
      const p = page && page > 0 ? page : 1;
      const total = await this.model.countDocuments(filter).exec();
      const docs = await this.model.find(filter).skip((p - 1) * limit).limit(limit).exec();
      return { page: p, limit, total, data: docs.map((o: any) => this.toModel(o)!) };
    } catch (error) { this.logger.error(error); throw error; }
  }

  private toModel(raw: any): StoredHttpPath | null | undefined {
    if (!raw) return raw as null | undefined;
    return raw.toJSON({ flattenMaps: false, transform: (doc: any, ret: any) => { ret._id = doc?._id?.toString(); } }) as StoredHttpPath;
  }

  private toPathDefinition(raw: any): PathDefinition {
    const { _id, enabled, __v, ...rest } = this.toModel(raw) as any;
    return rest as PathDefinition;
  }
}
