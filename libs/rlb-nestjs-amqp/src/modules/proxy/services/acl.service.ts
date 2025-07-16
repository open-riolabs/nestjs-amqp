export const RLB_GTW_ACL_ROLE_SERVICE = 'RLB_GTW_ACL_ROLE_SERVICE';
export interface IAclRoleService {
  canUserDo(topic: string, action: string, userId: string): Promise<boolean>;
}