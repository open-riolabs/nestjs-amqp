import { AclGrant } from './models';

/** The (companyId, resourceId) a request targets. Both optional. */
export interface AclResourceContext {
  companyId?: string | null;
  resourceId?: string | null;
}

/** Absent/empty (undefined, null, '') all normalize to null so they compare equal. */
function norm(v: unknown): string | null {
  return v === undefined || v === null || v === '' ? null : String(v);
}

/**
 * Exact-match authorization rule (NO wildcard): a grant matches the requested (companyId,
 * resourceId) iff both ids are equal after normalization. The only carve-out — both absent on
 * request AND grant (a resource-less global grant) — is subsumed by `null === null`.
 */
export function grantMatchesResource(grant: AclGrant, ctx?: AclResourceContext): boolean {
  return norm(grant?.companyId) === norm(ctx?.companyId) && norm(grant?.resourceId) === norm(ctx?.resourceId);
}
