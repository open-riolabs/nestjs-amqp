import { Inject, Injectable, Logger } from '@nestjs/common';
import { AclAction, AclActionRepository, flattenObject, PaginationModel } from '@open-rlb/nestjs-amqp';
import { FilterQuery, Model, Types } from 'mongoose';
import { ACL_ACTION_MODEL } from '../connections';

@Injectable()
export class MongoAclActionRepository extends AclActionRepository {
  private readonly logger = new Logger(MongoAclActionRepository.name);

  constructor(@Inject(ACL_ACTION_MODEL) private readonly model: Model<any>) {
    super();
  }

  async insert(model: AclAction): Promise<AclAction> {
    try {
      const data = await this.model.insertMany([{ ...model, _id: new Types.ObjectId() }]);
      return this.toModel(data.find((o) => !!o))!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async insertMany(models: AclAction[]): Promise<AclAction[]> {
    try {
      const docs = (models || []).map((m) => ({ ...m, _id: new Types.ObjectId() }));
      return (await this.model.insertMany(docs)).map((o) => this.toModel(o)!);
    } catch (error) { this.logger.error(error); throw error; }
  }

  async findByName(name: string): Promise<AclAction> {
    try { return this.toModel(await this.model.findOne({ name }).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async findOne(filter: FilterQuery<any>): Promise<AclAction> {
    try { return this.toModel(await this.model.findOne(filter).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async upsertOne(filter: FilterQuery<any>, model: Partial<AclAction>): Promise<AclAction> {
    try {
      const data = await this.model.findOneAndUpdate(filter, { $set: flattenObject(model), $setOnInsert: { _id: new Types.ObjectId() } }, { new: true, upsert: true }).exec();
      return this.toModel(data)!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async updateOne(filter: FilterQuery<any>, model: Partial<AclAction>): Promise<AclAction> {
    try {
      const data = await this.model.findOneAndUpdate(filter, { $set: flattenObject(model) }, { new: true }).exec();
      return this.toModel(data)!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  // $set (dot-notation) semantics: a partial merge, not a replace.
  async mergeOne(filter: FilterQuery<any>, model: Partial<AclAction>): Promise<AclAction> {
    return this.updateOne(filter, model);
  }

  async removeOne(filter: FilterQuery<any>): Promise<AclAction> {
    try { return this.toModel(await this.model.findOneAndDelete(filter).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async removeMany(filter: FilterQuery<any>): Promise<number> {
    try { return (await this.model.deleteMany(filter).exec()).deletedCount ?? 0; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async filter(filter: FilterQuery<any>): Promise<AclAction[]> {
    try {
      Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
      return (await this.model.find(filter).exec()).map((o) => this.toModel(o)!);
    } catch (error) { this.logger.error(error); throw error; }
  }

  async filterPaginated(filter: FilterQuery<any>, page?: number, limit?: number): Promise<PaginationModel<AclAction>> {
    Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
    let data: AclAction[] = [];
    try {
      const total = await this.model.countDocuments(filter).exec();
      if (total) {
        const query = this.model.find(filter);
        if (limit) { if (!page || page < 1) page = 1; query.skip((page - 1) * limit).limit(limit); }
        else query.limit(1000);
        data = (await query.exec()).map((o) => this.toModel(o)!);
      }
      return { page: page!, limit: limit!, total, data };
    } catch (error) { this.logger.error(error); throw error; }
  }

  async retrieveAll(): Promise<AclAction[]> {
    return this.filter({});
  }

  async retrieveAllPaginated(page: number, limit: number): Promise<PaginationModel<AclAction>> {
    return this.filterPaginated({}, page, limit);
  }

  // Actions have no id — strip the storage _id so responses expose only { name, description }.
  private toModel(raw: any): AclAction | null | undefined {
    if (!raw) return raw as null | undefined;
    return raw.toJSON({ flattenMaps: false, transform: (_doc: any, ret: any) => { delete ret._id; delete ret.__v; } }) as AclAction;
  }
}
