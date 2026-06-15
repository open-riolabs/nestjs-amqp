import { PaginationModel } from '../../../common';
import { AclAction } from '../models';

/**
 * Repository contract for ACL actions. Implemented by the consuming app (e.g. a
 * Mongo-backed class) and bound to this abstract token via DI. Mirrors the legacy
 * AccessActionRepository surface so existing implementations can be plugged in as-is.
 */
export abstract class AclActionRepository {
  abstract insert(model: AclAction): Promise<AclAction>;
  abstract insertMany(models: AclAction[]): Promise<AclAction[]>;
  abstract findById(id: string): Promise<AclAction>;
  abstract findOne(filter: Record<string, any>): Promise<AclAction>;
  abstract upsertById(id: string, model: Partial<AclAction>): Promise<AclAction>;
  abstract upsertOne(filter: Record<string, any>, model: Partial<AclAction>): Promise<AclAction>;
  abstract updateById(id: string, model: Partial<AclAction>): Promise<AclAction>;
  abstract updateOne(filter: Record<string, any>, model: Partial<AclAction>): Promise<AclAction>;
  /** Deep/partial merge ($set semantics) by id. */
  abstract mergeById(id: string, model: Partial<AclAction>): Promise<AclAction>;
  /** Deep/partial merge ($set semantics) by filter. */
  abstract mergeOne(filter: Record<string, any>, model: Partial<AclAction>): Promise<AclAction>;
  abstract removeById(id: string): Promise<AclAction>;
  abstract removeOne(filter: Record<string, any>): Promise<AclAction>;
  abstract removeMany(filter: Record<string, any>): Promise<number>;
  abstract filter(filter: Record<string, any>): Promise<AclAction[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclAction>>;
  abstract retrieveAll(): Promise<AclAction[]>;
  abstract retrieveAllPaginated(page: number, limit: number): Promise<PaginationModel<AclAction>>;
}
