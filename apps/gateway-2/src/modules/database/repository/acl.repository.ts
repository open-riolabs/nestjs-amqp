import { Injectable } from '@nestjs/common';
import {
  AclAction,
  AclActionRepository,
  AclGrant,
  AclGrantRepository,
  AclRole,
  AclRoleRepository,
  PaginationModel,
} from '@open-rlb/nestjs-amqp';
import { InMemoryCollection } from './in-memory-collection';

const page1 = (p?: number) => Number(p) || 1;
const lim10 = (l?: number) => Number(l) || 10;

@Injectable()
export class InMemoryAclActionRepository extends AclActionRepository {
  private readonly col = new InMemoryCollection<AclAction>();

  async insert(model: AclAction): Promise<AclAction> { return this.col.insert(model); }
  async insertMany(models: AclAction[]): Promise<AclAction[]> { return this.col.insertMany(models); }
  async findById(id: string): Promise<AclAction> { return this.col.findById(id)!; }
  async findOne(filter: Record<string, any>): Promise<AclAction> { return this.col.findOne(filter)!; }
  async upsertById(id: string, model: Partial<AclAction>): Promise<AclAction> { return this.col.upsertById(id, model); }
  async upsertOne(filter: Record<string, any>, model: Partial<AclAction>): Promise<AclAction> { return this.col.upsertOne(filter, model); }
  async updateById(id: string, model: Partial<AclAction>): Promise<AclAction> { return this.col.updateById(id, model)!; }
  async updateOne(filter: Record<string, any>, model: Partial<AclAction>): Promise<AclAction> { return this.col.updateOne(filter, model)!; }
  async mergeById(id: string, model: Partial<AclAction>): Promise<AclAction> { return this.col.updateById(id, model)!; }
  async mergeOne(filter: Record<string, any>, model: Partial<AclAction>): Promise<AclAction> { return this.col.updateOne(filter, model)!; }
  async removeById(id: string): Promise<AclAction> { return this.col.removeById(id)!; }
  async removeOne(filter: Record<string, any>): Promise<AclAction> { return this.col.removeOne(filter)!; }
  async removeMany(filter: Record<string, any>): Promise<number> { return this.col.removeMany(filter); }
  async filter(filter: Record<string, any>): Promise<AclAction[]> { return this.col.filter(filter); }
  async filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclAction>> { return this.col.paginate(filter, page1(page), lim10(limit)); }
  async retrieveAll(): Promise<AclAction[]> { return this.col.all(); }
  async retrieveAllPaginated(page: number, limit: number): Promise<PaginationModel<AclAction>> { return this.col.paginate({}, page1(page), lim10(limit)); }
}

@Injectable()
export class InMemoryAclRoleRepository extends AclRoleRepository {
  private readonly col = new InMemoryCollection<AclRole>();

  async insert(model: AclRole): Promise<AclRole> { return this.col.insert(model); }
  async insertMany(models: AclRole[]): Promise<AclRole[]> { return this.col.insertMany(models); }
  async findById(id: string): Promise<AclRole> { return this.col.findById(id)!; }
  async findOne(filter: Record<string, any>): Promise<AclRole> { return this.col.findOne(filter)!; }
  async upsertById(id: string, model: Partial<AclRole>): Promise<AclRole> { return this.col.upsertById(id, model); }
  async upsertOne(filter: Record<string, any>, model: Partial<AclRole>): Promise<AclRole> { return this.col.upsertOne(filter, model); }
  async updateById(id: string, model: Partial<AclRole>): Promise<AclRole> { return this.col.updateById(id, model)!; }
  async updateOne(filter: Record<string, any>, model: Partial<AclRole>): Promise<AclRole> { return this.col.updateOne(filter, model)!; }
  async mergeById(id: string, model: Partial<AclRole>): Promise<AclRole> { return this.col.updateById(id, model)!; }
  async removeById(id: string): Promise<AclRole> { return this.col.removeById(id)!; }
  async removeOne(filter: Record<string, any>): Promise<AclRole> { return this.col.removeOne(filter)!; }
  async filter(filter: Record<string, any>): Promise<AclRole[]> { return this.col.filter(filter); }
  async filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclRole>> { return this.col.paginate(filter, page1(page), lim10(limit)); }
  async list(): Promise<AclRole[]> { return this.col.all(); }
  async listPaginated(page: number, limit: number): Promise<PaginationModel<AclRole>> { return this.col.paginate({}, page1(page), lim10(limit)); }

  async getActionsByNames(names: string[]): Promise<string[]> {
    if (!names?.length) return [];
    const roles = this.col.filter({ name: { $in: names } });
    return [...new Set(roles.flatMap((r) => r.actions || []))];
  }
}

@Injectable()
export class InMemoryAclGrantRepository extends AclGrantRepository {
  private readonly col = new InMemoryCollection<AclGrant>();

  async insert(model: AclGrant): Promise<AclGrant> { return this.col.insert(model); }
  async findById(id: string): Promise<AclGrant> { return this.col.findById(id)!; }
  async findOne(filter: Record<string, any>): Promise<AclGrant> { return this.col.findOne(filter)!; }
  async updateById(id: string, model: Partial<AclGrant>): Promise<AclGrant> { return this.col.updateById(id, model)!; }
  async updateOne(filter: Record<string, any>, model: Partial<AclGrant>): Promise<AclGrant> { return this.col.updateOne(filter, model)!; }
  async mergeById(id: string, model: Partial<AclGrant>): Promise<AclGrant> { return this.col.updateById(id, model)!; }
  async removeById(id: string): Promise<AclGrant> { return this.col.removeById(id)!; }
  async removeOne(filter: Record<string, any>): Promise<AclGrant> { return this.col.removeOne(filter)!; }
  async filter(filter: Record<string, any>): Promise<AclGrant[]> { return this.col.filter(filter); }
  async filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclGrant>> { return this.col.paginate(filter, page1(page), lim10(limit)); }
}
