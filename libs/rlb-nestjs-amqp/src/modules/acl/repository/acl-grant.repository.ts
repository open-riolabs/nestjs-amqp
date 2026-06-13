import { PaginationModel } from '../../../common';
import { AclGrant } from '../models';

/** Repository contract for ACL grants. Implemented by the consuming app. */
export abstract class AclGrantRepository {
  abstract insert(model: AclGrant): Promise<AclGrant>;
  abstract findOne(filter: Record<string, any>): Promise<AclGrant>;
  abstract updateOne(filter: Record<string, any>, model: Partial<AclGrant>): Promise<AclGrant>;
  abstract removeOne(filter: Record<string, any>): Promise<AclGrant>;
  abstract filter(filter: Record<string, any>): Promise<AclGrant[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclGrant>>;
  /**
   * True when at least one matching grant gives the user every requested action
   * (via the actions of its roles).
   */
  abstract checkActions(filter: Record<string, any>, actions: string | string[]): Promise<boolean>;
}
