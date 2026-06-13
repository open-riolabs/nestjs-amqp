/** Broker topic the gateway-admin handlers are bound to. The consumer declares a
 *  matching topic and points `gateway.loadConfig.paths` to {topic: this, action: 'gw-path-export'}. */
export const GATEWAY_ADMIN_TOPIC = 'rlb-gateway-admin';

export const RLB_GW_ADMIN_OPTIONS = 'RLB_GW_ADMIN_OPTIONS';

export const GW_ADMIN_ACTIONS = {
  pathCreate: 'gw-path-create',
  pathUpdate: 'gw-path-update',
  pathDelete: 'gw-path-delete',
  pathGet: 'gw-path-get',
  pathList: 'gw-path-list',
  pathExport: 'gw-path-export',
  authCreate: 'gw-auth-create',
  authUpdate: 'gw-auth-update',
  authDelete: 'gw-auth-delete',
  authGet: 'gw-auth-get',
  authList: 'gw-auth-list',
  authExport: 'gw-auth-export',
  metricsTrack: 'gw-metrics-track',
  metricsGet: 'gw-metrics-get',
} as const;
