import { PaginationModel } from '../../../common';
import { PathDefinition } from '../../proxy/config/path-definition.config';

export type StoredHttpPath = Partial<PathDefinition> & { _id?: string; enabled?: boolean; };

/** Repository contract for stored HTTP gateway paths. Implemented by the consuming app. */
export abstract class HttpPathRepository {
  abstract insert(model: StoredHttpPath): Promise<StoredHttpPath>;
  abstract findById(id: string): Promise<StoredHttpPath>;
  abstract findOne(filter: Record<string, any>): Promise<StoredHttpPath>;
  abstract updateById(id: string, model: StoredHttpPath): Promise<StoredHttpPath>;
  abstract removeById(id: string): Promise<StoredHttpPath>;
  /** Enabled paths mapped to plain PathDefinition objects (no _id/enabled). */
  abstract listEnabled(): Promise<PathDefinition[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<StoredHttpPath>>;
}
