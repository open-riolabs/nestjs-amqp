/** Broker topic the ACL handlers are bound to. The consumer must declare a matching
 *  topic/queue in its broker config and point auth-provider `aclTopic` to this value. */
export const ACL_TOPIC = 'rlb-acl';

export const RLB_ACL_OPTIONS = 'RLB_ACL_OPTIONS';
/** Optional L2 cache store provider (consumer-supplied). Injected with @Optional(). */
export const RLB_ACL_CACHE_STORE = 'RLB_ACL_CACHE_STORE';

/** Lib-defined action names handled on ACL_TOPIC. */
export const ACL_ACTIONS = {
  canUserDo: 'acl-can-user-do',
  grant: 'acl-grant',
  revoke: 'acl-revoke',
  invalidate: 'acl-invalidate',
  actionCreate: 'acl-action-create',
  actionUpdate: 'acl-action-update',
  actionDelete: 'acl-action-delete',
  actionList: 'acl-action-list',
  roleCreate: 'acl-role-create',
  roleUpdate: 'acl-role-update',
  roleDelete: 'acl-role-delete',
  roleList: 'acl-role-list',
} as const;
