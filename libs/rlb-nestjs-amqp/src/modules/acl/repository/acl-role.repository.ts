import { PaginationModel } from '../../../common';
import { AclRole } from '../models';

/**
 * Repository contract for ACL roles. Implemented by the consuming app. Mirrors the legacy
 * RoleRepository surface (minus the mongoose-specific *Raw helpers, which would leak the
 * driver into this abstraction).
 */
export abstract class AclRoleRepository {
  abstract insert(model: AclRole): Promise<AclRole>;
  abstract insertMany(models: AclRole[]): Promise<AclRole[]>;
  /** Lookup by the entity key (name). Roles have no id. */
  abstract findByName(name: string): Promise<AclRole>;
  abstract findOne(filter: Record<string, any>): Promise<AclRole>;
  abstract upsertOne(filter: Record<string, any>, model: Partial<AclRole>): Promise<AclRole>;
  abstract updateOne(filter: Record<string, any>, model: Partial<AclRole>): Promise<AclRole>;
  abstract removeOne(filter: Record<string, any>): Promise<AclRole>;
  abstract filter(filter: Record<string, any>): Promise<AclRole[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<AclRole>>;
  abstract list(): Promise<AclRole[]>;
  abstract listPaginated(page: number, limit: number): Promise<PaginationModel<AclRole>>;
  /** Flattened, de-duplicated set of actions granted by the given role names. */
  abstract getActionsByNames(names: string[]): Promise<string[]>;
  /** Free-text search over roles → matching roles. The implementation runs an optimized store
   *  query (e.g. a Mongo regex/text index); `limit` caps the result, an empty `q` lists. */
  abstract search(q?: string, page?: number, limit?: number): Promise<PaginationModel<AclRole>>;
}
