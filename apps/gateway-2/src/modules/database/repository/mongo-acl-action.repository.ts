import { Inject, Injectable, Logger } from '@nestjs/common';
import { AclAction, AclActionRepository, flattenObject, PaginationModel } from '@open-rlb/nestjs-amqp';
import { FilterQuery, Model, Types } from 'mongoose';
import { ACL_ACTION_MODEL } from '../connections';

@Injectable()
export class MongoAclActionRepository extends AclActionRepository {
  private readonly logger = new Logger(MongoAclActionRepository.name);

  constructor(@Inject(ACL_ACTION_MODEL) private readonly model: Model<AclAction<Types.ObjectId>>) {
    super();
  }

  async insert(model: AclAction): Promise<AclAction> {
    try {
      const data = await this.model.insertMany([{ ...model, _id: new Types.ObjectId() }]);
      return this.toModel(data.find((o) => !!o))!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async findById(id: string): Promise<AclAction> {
    try { return this.toModel(await this.model.findById(new Types.ObjectId(id)).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async findOne(filter: FilterQuery<AclAction>): Promise<AclAction> {
    try { return this.toModel(await this.model.findOne(filter).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async updateById(id: string, model: Partial<AclAction>): Promise<AclAction> {
    try {
      const data = await this.model.findOneAndUpdate({ _id: new Types.ObjectId(id) }, { $set: flattenObject(model) }, { new: true }).exec();
      return this.toModel(data)!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async removeById(id: string): Promise<AclAction> {
    try { return this.toModel(await this.model.findOneAndDelete({ _id: new Types.ObjectId(id) }).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async filter(filter: FilterQuery<AclAction>): Promise<AclAction[]> {
    try {
      Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
      return (await this.model.find(filter).exec()).map((o) => this.toModel(o)!);
    } catch (error) { this.logger.error(error); throw error; }
  }

  async filterPaginated(filter: FilterQuery<AclAction>, page?: number, limit?: number): Promise<PaginationModel<AclAction>> {
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

  private toModel(raw: any): AclAction | null | undefined {
    if (!raw) return raw as null | undefined;
    return raw.toJSON({ flattenMaps: false, transform: (doc: any, ret: any) => { ret._id = doc?._id?.toString(); } }) as AclAction;
  }
}
