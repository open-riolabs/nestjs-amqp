import { Inject, Injectable, Logger } from '@nestjs/common';
import { AclRole, AclRoleRepository, flattenObject, PaginationModel } from '@open-rlb/nestjs-amqp';
import { FilterQuery, Model, Types } from 'mongoose';
import { ACL_ROLE_MODEL } from '../connections';

@Injectable()
export class MongoAclRoleRepository extends AclRoleRepository {
  private readonly logger = new Logger(MongoAclRoleRepository.name);

  constructor(@Inject(ACL_ROLE_MODEL) private readonly model: Model<any>) {
    super();
  }

  async insert(model: AclRole): Promise<AclRole> {
    try {
      const data = await this.model.insertMany([{ ...model, _id: new Types.ObjectId() }]);
      return this.toModel(data.find((o) => !!o))!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async insertMany(models: AclRole[]): Promise<AclRole[]> {
    try {
      const docs = (models || []).map((m) => ({ ...m, _id: new Types.ObjectId() }));
      return (await this.model.insertMany(docs)).map((o) => this.toModel(o)!);
    } catch (error) { this.logger.error(error); throw error; }
  }

  async findByName(name: string): Promise<AclRole> {
    try { return this.toModel(await this.model.findOne({ name }).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async findOne(filter: FilterQuery<any>): Promise<AclRole> {
    try { return this.toModel(await this.model.findOne(filter).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async upsertOne(filter: FilterQuery<any>, model: Partial<AclRole>): Promise<AclRole> {
    try {
      const data = await this.model.findOneAndUpdate(filter, { $set: flattenObject(model), $setOnInsert: { _id: new Types.ObjectId() } }, { new: true, upsert: true }).exec();
      return this.toModel(data)!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async updateOne(filter: FilterQuery<any>, model: Partial<AclRole>): Promise<AclRole> {
    try {
      const data = await this.model.findOneAndUpdate(filter, { $set: flattenObject(model) }, { new: true }).exec();
      return this.toModel(data)!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async removeOne(filter: FilterQuery<any>): Promise<AclRole> {
    try { return this.toModel(await this.model.findOneAndDelete(filter).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async filter(filter: FilterQuery<any>): Promise<AclRole[]> {
    try {
      Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
      return (await this.model.find(filter).exec()).map((o) => this.toModel(o)!);
    } catch (error) { this.logger.error(error); throw error; }
  }

  async filterPaginated(filter: FilterQuery<any>, page?: number, limit?: number): Promise<PaginationModel<AclRole>> {
    Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
    let data: AclRole[] = [];
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

  async list(): Promise<AclRole[]> {
    return this.filter({});
  }

  async listPaginated(page: number, limit: number): Promise<PaginationModel<AclRole>> {
    return this.filterPaginated({}, page, limit);
  }

  async getActionsByNames(names: string[]): Promise<string[]> {
    try {
      if (!names?.length) return [];
      const roles = await this.model.find({ name: { $in: names } }).exec();
      const actions = roles.flatMap((r: any) => (r.actions || []) as string[]);
      return Array.from(new Set(actions));
    } catch (error) { this.logger.error(error); throw error; }
  }

  // Roles have no id — strip the storage _id so responses expose only { name, description, actions }.
  private toModel(raw: any): AclRole | null | undefined {
    if (!raw) return raw as null | undefined;
    return raw.toJSON({ flattenMaps: false, transform: (_doc: any, ret: any) => { delete ret._id; delete ret.__v; } }) as AclRole;
  }
}
