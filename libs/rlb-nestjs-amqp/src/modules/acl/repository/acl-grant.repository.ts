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
  /**
   * True when at least one matching grant gives the user every requested action
   * (via the actions of its roles).
   */
  abstract checkActions(filter: Record<string, any>, actions: string | string[]): Promise<boolean>;
}
