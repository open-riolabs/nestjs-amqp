import { PaginationModel } from '../../../common';
import { AclAction } from '../models';

/**
 * Repository contract for ACL actions. Implemented by the consuming app (e.g. a
 * Mongo-backed class) and bound to this abstract token via DI.
 */
export abstract class AclActionRepository {
  abstract insert(model: AclAction): Promise<AclAction>;
  abstract findById(id: string): Promise<AclAction>;
  abstract findOne(filter: Record<string, any>): Promise<AclAction>;
  abstract updateById(id: string, model: Partial<AclAction>): Promise<AclAction>;
  abstract removeById(id: string): Promise<AclAction>;
  abstract filter(filter: Record<string, any>): Promise<AclAction[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclAction>>;
}
