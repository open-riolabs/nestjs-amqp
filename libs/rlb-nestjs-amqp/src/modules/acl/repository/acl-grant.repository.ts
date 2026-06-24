import { PaginationModel } from '../../../common';
import { AclGrant } from '../models';

/**
 * Repository contract for ACL grants (the legacy AccessControl). Implemented by the
 * consuming app. `roles` on the grant maps to the legacy `access-roles` field.
 */
export abstract class AclGrantRepository {
  abstract insert(model: AclGrant): Promise<AclGrant>;
  abstract findById(id: string): Promise<AclGrant>;
  abstract findOne(filter: Record<string, any>): Promise<AclGrant>;
  abstract updateById(id: string, model: Partial<AclGrant>): Promise<AclGrant>;
  abstract updateOne(filter: Record<string, any>, model: Partial<AclGrant>): Promise<AclGrant>;
  /** Deep/partial merge ($set semantics) by id. */
  abstract mergeById(id: string, model: Partial<AclGrant>): Promise<AclGrant>;
  abstract removeById(id: string): Promise<AclGrant>;
  abstract removeOne(filter: Record<string, any>): Promise<AclGrant>;
  abstract filter(filter: Record<string, any>): Promise<AclGrant[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclGrant>>;
  /** Free-text search over grants (access) → matching grants. The implementation runs an optimized
   *  store query (e.g. a Mongo regex/text index); `limit` caps the result, an empty `q` lists. */
  abstract search(q?: string, page?: number, limit?: number): Promise<PaginationModel<AclGrant>>;
}
