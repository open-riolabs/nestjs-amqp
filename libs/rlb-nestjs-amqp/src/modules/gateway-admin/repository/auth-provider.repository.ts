import { PaginationModel } from '../../../common';
import { HandlerAuthConfig } from '../../broker/config/handler-auth.config';

// Auth-providers have NO id — `name` is the sole identity (the key).
export type StoredAuthProvider = Partial<HandlerAuthConfig> & { enabled?: boolean; };

/** Repository contract for stored auth-providers. Implemented by the consuming app. */
export abstract class AuthProviderRepository {
  abstract insert(model: StoredAuthProvider): Promise<StoredAuthProvider>;
  /** Lookup by the entity key (name). */
  abstract findByName(name: string): Promise<StoredAuthProvider>;
  abstract findOne(filter: Record<string, any>): Promise<StoredAuthProvider>;
  /** Create-or-update by name (PUT semantics). */
  abstract upsertByName(name: string, model: StoredAuthProvider): Promise<StoredAuthProvider>;
  abstract removeByName(name: string): Promise<StoredAuthProvider>;
  /** Enabled providers mapped to plain HandlerAuthConfig objects. */
  abstract listEnabled(): Promise<HandlerAuthConfig[]>;
  abstract filterPaginated(filter: Record<string, any>, page?: number, limit?: number): Promise<PaginationModel<StoredAuthProvider>>;
  abstract search(q?: string, page?: number, limit?: number): Promise<PaginationModel<StoredAuthProvider>>;
}
