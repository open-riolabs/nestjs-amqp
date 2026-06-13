import { PaginationModel } from '../../../common';
import { HandlerAuthConfig } from '../../broker/config/handler-auth.config';

export type StoredAuthProvider = Partial<HandlerAuthConfig> & { _id?: string; enabled?: boolean; };

/** Repository contract for stored auth-providers. Implemented by the consuming app. */
export abstract class AuthProviderRepository {
  abstract insert(model: StoredAuthProvider): Promise<StoredAuthProvider>;
  abstract findById(id: string): Promise<StoredAuthProvider>;
  abstract findOne(filter: Record<string, any>): Promise<StoredAuthProvider>;
  abstract updateById(id: string, model: StoredAuthProvider): Promise<StoredAuthProvider>;
  abstract removeById(id: string): Promise<StoredAuthProvider>;
  /** Enabled providers mapped to plain HandlerAuthConfig objects. */
  abstract listEnabled(): Promise<HandlerAuthConfig[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<StoredAuthProvider>>;
}
