/** Broker topic the ACL handlers are bound to. The consumer must declare a matching
 *  topic/queue in its broker config. (The gateway authorization check runs in-process via
 *  IAclRoleService, so auth-providers no longer need an `aclTopic`/`aclAction`.) */
export const ACL_TOPIC = 'rlb-acl';

export const RLB_ACL_OPTIONS = 'RLB_ACL_OPTIONS';
/** Optional L2 cache store provider (consumer-supplied). Injected with @Optional(). */
export const RLB_ACL_CACHE_STORE = 'RLB_ACL_CACHE_STORE';

/** Default action a caller must hold (on the target company/resource) to grant or revoke.
 *  Override per-deployment via `AclModuleOptions.roleManagementAction`. */
export const ACL_DEFAULT_ROLE_MANAGEMENT_ACTION = 'role-management';

/** Lib-defined action names handled on ACL_TOPIC. */
export const ACL_ACTIONS = {
  /** The single authorization primitive {userId, action(s), companyId?, resourceId?}: true when
   *  the user holds an action via any role, on the EXACT (companyId, resourceId) (no wildcard). */
  checkAction: 'acl-check-action',
  /** Lists the resources a user can access, grouped by company, with their actions. */
  listResourcesByUser: 'acl-list-resources-by-user',
  grant: 'acl-grant',
  revoke: 'acl-revoke',
  invalidate: 'acl-invalidate',
  // Actions & roles are keyed by `name` (no separate id). PUT upserts by name; there is no POST.
  actionUpdate: 'acl-action-update',
  actionDelete: 'acl-action-delete',
  actionList: 'acl-action-list',
  actionGet: 'acl-action-get',
  roleUpdate: 'acl-role-update',
  roleDelete: 'acl-role-delete',
  roleList: 'acl-role-list',
  roleGet: 'acl-role-get',
} as const;
