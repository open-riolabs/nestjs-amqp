export const RLB_GTW_ACL_ROLE_SERVICE = 'RLB_GTW_ACL_ROLE_SERVICE';
export interface IAclRoleService {
  /** Gateway primary filter (resource-agnostic): true when the user holds at least one of
   *  `roles`. userId from the auth provider, roles from the path config — no topic/action. */
  canUserDoGtw(roles: string | string[], userId: string): Promise<boolean>;
  /** MS-side resource-scoped check: true when a global grant OR a grant bound to `resourceId`
   *  gives the user at least one of `roles`. The resource is known only to the microservice. */
  canUserDo(roles: string | string[], userId: string, resourceId?: string): Promise<boolean>;
}