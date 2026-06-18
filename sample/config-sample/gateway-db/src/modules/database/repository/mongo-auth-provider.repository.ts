import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuthProviderRepository, flattenObject, HandlerAuthConfig, PaginationModel, StoredAuthProvider } from '@open-rlb/nestjs-amqp';
import { FilterQuery, Model, Types } from 'mongoose';
import { AUTH_PROVIDER_MODEL } from '../connections';

@Injectable()
export class MongoAuthProviderRepository extends AuthProviderRepository {
  private readonly logger = new Logger(MongoAuthProviderRepository.name);

  constructor(@Inject(AUTH_PROVIDER_MODEL) private readonly model: Model<any>) {
    super();
  }

  async insert(model: StoredAuthProvider): Promise<StoredAuthProvider> {
    try {
      const data = await this.model.insertMany([{ ...model, _id: new Types.ObjectId() }]);
      return this.toModel(data.find((o: any) => !!o))!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async findByName(name: string): Promise<StoredAuthProvider> {
    try { return this.toModel(await this.model.findOne({ name }).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async findOne(filter: FilterQuery<any>): Promise<StoredAuthProvider> {
    try { return this.toModel(await this.model.findOne(filter).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async upsertByName(name: string, model: StoredAuthProvider): Promise<StoredAuthProvider> {
    try {
      const data = await this.model.findOneAndUpdate({ name }, { $set: flattenObject(model), $setOnInsert: { _id: new Types.ObjectId() } }, { new: true, upsert: true }).exec();
      return this.toModel(data)!;
    } catch (error) { this.logger.error(error); throw error; }
  }

  async removeByName(name: string): Promise<StoredAuthProvider> {
    try { return this.toModel(await this.model.findOneAndDelete({ name }).exec())!; }
    catch (error) { this.logger.error(error); throw error; }
  }

  async listEnabled(): Promise<HandlerAuthConfig[]> {
    try {
      const data = await this.model.find({ enabled: { $ne: false } }).exec();
      return data.map((o: any) => this.toAuthConfig(o));
    } catch (error) { this.logger.error(error); throw error; }
  }

  async filterPaginated(filter: FilterQuery<any>, page?: number, limit?: number): Promise<PaginationModel<StoredAuthProvider>> {
    Object.keys(filter).forEach((key) => filter[key] === undefined && delete filter[key]);
    let data: StoredAuthProvider[] = [];
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

  // Auth-providers have no id — strip the storage _id so responses are name-keyed only.
  private toModel(raw: any): StoredAuthProvider | null | undefined {
    if (!raw) return raw as null | undefined;
    return raw.toJSON({ flattenMaps: false, transform: (_doc: any, ret: any) => { delete ret._id; delete ret.__v; } }) as StoredAuthProvider;
  }

  private toAuthConfig(raw: any): HandlerAuthConfig {
    const { enabled, ...rest } = this.toModel(raw) as any;
    return rest as HandlerAuthConfig;
  }
}
