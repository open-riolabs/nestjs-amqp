import { PaginationModel } from '../../../common';
import { AclRole } from '../models';

/** Repository contract for ACL roles. Implemented by the consuming app. */
export abstract class AclRoleRepository {
  abstract insert(model: AclRole): Promise<AclRole>;
  abstract findOne(filter: Record<string, any>): Promise<AclRole>;
  abstract updateOne(filter: Record<string, any>, model: Partial<AclRole>): Promise<AclRole>;
  abstract removeOne(filter: Record<string, any>): Promise<AclRole>;
  abstract filter(filter: Record<string, any>): Promise<AclRole[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclRole>>;
}
