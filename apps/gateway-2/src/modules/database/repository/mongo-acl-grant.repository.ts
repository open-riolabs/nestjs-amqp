import { Inject, Injectable, Logger } from '@nestjs/common';
import { AclGrant, AclGrantRepository, flattenObject, PaginationModel } from '@open-rlb/nestjs-amqp';
import { FilterQuery, Model, Types } from 'mongoose';
import { ACL_GRANT_MODEL } from '../connections';

@Injectable()
export class MongoAclGrantRepository extends AclGrantRepository {
  private readonly logger = new Logger(MongoAclGrantRepository.name);

  constructor(@Inject(ACL_GRANT_MODEL) private readonly model: Model<AclGrant<Types.ObjectId>>) {
    super();
  }

  async insert(model: AclGrant): Promise<AclGrant> {
    try {
      const data = await this.model.insertMany([{ ...model, _id: new Types.ObjectId() }]);
      return this.toModel(data.find((o) => !!o))!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async findOne(filter: FilterQuery<AclGrant>): Promise<AclGrant> {
    try { return this.toModel(await this.model.findOne(filter).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async updateOne(filter: FilterQuery<AclGrant>, model: Partial<AclGrant>): Promise<AclGrant> {
    try {
      const data = await this.model.findOneAndUpdate(filter, { $set: flattenObject(model) }, { new: true }).exec();
      return this.toModel(data)!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async removeOne(filter: FilterQuery<AclGrant>): Promise<AclGrant> {
    try { return this.toModel(await this.model.findOneAndDelete(filter).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async filter(filter: FilterQuery<AclGrant>): Promise<AclGrant[]> {
    try {
      Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
      return (await this.model.find(filter).exec()).map((o) => this.toModel(o)!);
    } catch (error) { this.logger.error(error); throw error; }
  }

  async filterPaginated(filter: FilterQuery<AclGrant>, page?: number, limit?: number): Promise<PaginationModel<AclGrant>> {
    Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
    let data: AclGrant[] = [];
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

  async checkActions(filter: FilterQuery<AclGrant>, actions: string | string[]): Promise<boolean> {
    const requested = typeof actions === 'string' ? [actions] : actions;
    if (!requested?.length) throw new Error('Actions is required');
    try {
      const result = await this.model.aggregate([
        { $match: filter },
        { $lookup: { from: 'acl-role', localField: 'roles', foreignField: 'name', as: 'roleDocs' } },
        { $project: { allActions: { $reduce: { input: '$roleDocs.actions', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } } } },
        { $match: { $expr: { $setIsSubset: [requested, '$allActions'] } } },
        { $limit: 1 },
        { $count: 'matches' },
      ]).exec();
      return (result?.[0]?.matches ?? 0) > 0;
    } catch (error) { this.logger.error(error); throw error; }
  }

  private toModel(raw: any): AclGrant | null | undefined {
    if (!raw) return raw as null | undefined;
    return raw.toJSON({ flattenMaps: false, transform: (doc: any, ret: any) => { ret._id = doc?._id?.toString(); } }) as AclGrant;
  }
}
