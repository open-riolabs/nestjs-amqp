import { AclContextConfig } from './path-definition.config';

/** The resolved names of the fields the gateway ACL reads the resource context from. */
export type AclContextFields = Required<AclContextConfig>;

/** Canonical field names, used for every key `gateway.aclContext` leaves out. */
export const DEFAULT_ACL_CONTEXT_FIELDS: Readonly<AclContextFields> = Object.freeze({
  companyId: 'companyId',
  resourceId: 'resourceId',
});

const KEYS = Object.keys(DEFAULT_ACL_CONTEXT_FIELDS) as (keyof AclContextFields)[];

/**
 * Validates `gateway.aclContext` and resolves it against the canonical names. Strict on purpose:
 * this setting decides WHICH value the authorization runs on, so a mistake (unknown key such as a
 * `resourceID` typo, empty/null/non-string value, both ids mapped to the same field) must stop the
 * gateway at boot rather than silently fall back to a field the requests do not carry.
 */
export function resolveAclContextFields(config: unknown): AclContextFields {
  if (config === undefined || config === null) return { ...DEFAULT_ACL_CONTEXT_FIELDS };
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`gateway.aclContext must be an object with optional ${KEYS.map((k) => `'${k}'`).join('/')} fields`);
  }
  const out: AclContextFields = { ...DEFAULT_ACL_CONTEXT_FIELDS };
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (!(KEYS as string[]).includes(key)) {
      throw new Error(`gateway.aclContext: unknown key '${key}' (allowed: ${KEYS.join(', ')})`);
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`gateway.aclContext.${key} must be a non-empty string (omit it to read '${key}')`);
    }
    out[key as keyof AclContextFields] = value.trim();
  }
  if (out.companyId === out.resourceId) {
    throw new Error(`gateway.aclContext: companyId and resourceId must be read from different fields (both are '${out.companyId}')`);
  }
  return out;
}
