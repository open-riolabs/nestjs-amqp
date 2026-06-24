import { AclResourceContext } from '../../acl/auth-match';

export const RLB_GTW_ACL_ROLE_SERVICE = 'RLB_GTW_ACL_ROLE_SERVICE';
export interface IAclRoleService {
  /**
   * The single ACL authorization primitive. True when `userId` holds at least one of `action`
   * (via any role) on the EXACT (companyId, resourceId) in `ctx` — strict match, the only carve-out
   * being both ids absent on the request AND the grant. `ctx === undefined` skips resource scoping
   * (WebSocket events, which carry no resource).
   */
  checkAction(userId: string, ctx: AclResourceContext | undefined, action: string | string[]): Promise<boolean>;
}
