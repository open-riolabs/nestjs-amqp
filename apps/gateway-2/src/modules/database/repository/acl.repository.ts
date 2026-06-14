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

@Injectable()
export class InMemoryAclActionRepository extends AclActionRepository {
  private readonly col = new InMemoryCollection<AclAction>();

  async insert(model: AclAction): Promise<AclAction> { return this.col.insert(model); }
  async findById(id: string): Promise<AclAction> { return this.col.findById(id)!; }
  async findOne(filter: Record<string, any>): Promise<AclAction> { return this.col.findOne(filter)!; }
  async updateById(id: string, model: Partial<AclAction>): Promise<AclAction> { return this.col.updateById(id, model)!; }
  async removeById(id: string): Promise<AclAction> { return this.col.removeById(id)!; }
  async filter(filter: Record<string, any>): Promise<AclAction[]> { return this.col.filter(filter); }
  async filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclAction>> {
    return this.col.paginate(filter, Number(page) || 1, Number(limit) || 10);
  }
}

@Injectable()
export class InMemoryAclRoleRepository extends AclRoleRepository {
  private readonly col = new InMemoryCollection<AclRole>();

  async insert(model: AclRole): Promise<AclRole> { return this.col.insert(model); }
  async findOne(filter: Record<string, any>): Promise<AclRole> { return this.col.findOne(filter)!; }
  async updateOne(filter: Record<string, any>, model: Partial<AclRole>): Promise<AclRole> { return this.col.updateOne(filter, model)!; }
  async removeOne(filter: Record<string, any>): Promise<AclRole> { return this.col.removeOne(filter)!; }
  async filter(filter: Record<string, any>): Promise<AclRole[]> { return this.col.filter(filter); }
  async filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclRole>> {
    return this.col.paginate(filter, Number(page) || 1, Number(limit) || 10);
  }
}

@Injectable()
export class InMemoryAclGrantRepository extends AclGrantRepository {
  private readonly col = new InMemoryCollection<AclGrant>();

  // Needs role data to resolve role -> actions (Mongo did this with a $lookup).
  constructor(private readonly roles: InMemoryAclRoleRepository) { super(); }

  async insert(model: AclGrant): Promise<AclGrant> { return this.col.insert(model); }
  async findOne(filter: Record<string, any>): Promise<AclGrant> { return this.col.findOne(filter)!; }
  async updateOne(filter: Record<string, any>, model: Partial<AclGrant>): Promise<AclGrant> { return this.col.updateOne(filter, model)!; }
  async removeOne(filter: Record<string, any>): Promise<AclGrant> { return this.col.removeOne(filter)!; }
  async filter(filter: Record<string, any>): Promise<AclGrant[]> { return this.col.filter(filter); }
  async filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclGrant>> {
    return this.col.paginate(filter, Number(page) || 1, Number(limit) || 10);
  }

  async checkActions(filter: Record<string, any>, actions: string | string[]): Promise<boolean> {
    const requested = typeof actions === 'string' ? [actions] : actions;
    if (!requested?.length) throw new Error('Actions is required');
    const grants = this.col.filter(filter);
    if (!grants.length) return false;
    const roleNames = [...new Set(grants.flatMap((g) => g.roles || []))];
    const roleDocs = await this.roles.filter({ name: { $in: roleNames } });
    const allowed = new Set(roleDocs.flatMap((r) => r.actions || []));
    return requested.every((a) => allowed.has(a));
  }
}
