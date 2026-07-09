/**
 * The management HTTP routes a gateway exposes so the ACL and gateway-admin RPC surfaces are
 * reachable over HTTP. Seeded into `gateway.paths[]` (idempotent upsert by `name`) so the wired
 * AclModule / GatewayAdminModule are actually usable — a gateway with the modules but no routes
 * is inert. Name-keyed resources use PUT-upsert (no POST); `acl-grant`/`acl-revoke` are the exception.
 */

export interface GatewayPath {
  name: string;
  method: string;
  path: string;
  dataSource: string;
  topic: string;
  action: string;
  mode: string;
  headers?: Record<string, string>;
}

/** ACL management + check routes (topic `rlb-acl`). */
export function aclManagementPaths(): GatewayPath[] {
  const rpc = (name: string, method: string, path: string, dataSource: string, action: string): GatewayPath => ({
    name,
    method,
    path,
    dataSource,
    topic: 'rlb-acl',
    action,
    mode: 'rpc',
  });
  return [
    rpc('acl-action-list', 'GET', '/acl/actions', 'query', 'acl-action-list'),
    rpc('acl-action-get', 'GET', '/acl/actions/get', 'query', 'acl-action-get'),
    rpc('acl-action-upsert', 'PUT', '/acl/actions', 'body', 'acl-action-update'),
    rpc('acl-action-delete', 'DELETE', '/acl/actions', 'body', 'acl-action-delete'),
    rpc('acl-action-search', 'GET', '/acl/actions/search', 'query', 'acl-action-search'),
    rpc('acl-role-list', 'GET', '/acl/roles', 'query', 'acl-role-list'),
    rpc('acl-role-get', 'GET', '/acl/roles/get', 'query', 'acl-role-get'),
    rpc('acl-role-upsert', 'PUT', '/acl/roles', 'body', 'acl-role-update'),
    rpc('acl-role-delete', 'DELETE', '/acl/roles', 'body', 'acl-role-delete'),
    rpc('acl-role-search', 'GET', '/acl/roles/search', 'query', 'acl-role-search'),
    rpc('acl-grant', 'POST', '/acl/grants', 'body', 'acl-grant'),
    rpc('acl-revoke', 'DELETE', '/acl/grants', 'body', 'acl-revoke'),
    rpc('acl-grant-search', 'GET', '/acl/grants/search', 'query', 'acl-grant-search'),
    rpc('acl-check-action', 'GET', '/acl/check', 'query', 'acl-check-action'),
    rpc('acl-list-resources-by-user', 'GET', '/acl/resources', 'query', 'acl-list-resources-by-user'),
  ];
}

/** Gateway-admin routes (topic `rlb-gateway-admin`; the two reloads publish on `controlTopic`). */
export function adminManagementPaths(controlTopic: string): GatewayPath[] {
  const rpc = (name: string, method: string, path: string, dataSource: string, action: string): GatewayPath => ({
    name,
    method,
    path,
    dataSource,
    topic: 'rlb-gateway-admin',
    action,
    mode: 'rpc',
  });
  return [
    rpc('health', 'GET', '/health', 'query', 'gw-health'),
    rpc('gw-path-create', 'POST', '/admin/paths', 'body', 'gw-path-create'),
    rpc('gw-path-list', 'GET', '/admin/paths', 'query', 'gw-path-list'),
    rpc('gw-path-search', 'GET', '/admin/paths/search', 'query', 'gw-path-search'),
    rpc('gw-path-export', 'GET', '/admin/paths/export', 'query', 'gw-path-export'),
    rpc('gw-path-update', 'PUT', '/admin/paths', 'body', 'gw-path-update'),
    rpc('gw-path-get', 'GET', '/admin/paths/get', 'query', 'gw-path-get'),
    rpc('gw-path-delete', 'DELETE', '/admin/paths', 'body', 'gw-path-delete'),
    rpc('gw-route-log-list', 'GET', '/admin/route-log', 'query', 'gw-route-log-list'),
    rpc('gw-route-log-search', 'GET', '/admin/route-log/search', 'query', 'gw-route-log-search'),
    rpc('gw-auth-list', 'GET', '/admin/auth', 'query', 'gw-auth-list'),
    rpc('gw-auth-search', 'GET', '/admin/auth/search', 'query', 'gw-auth-search'),
    rpc('gw-auth-upsert', 'PUT', '/admin/auth', 'body', 'gw-auth-update'),
    rpc('gw-auth-get', 'GET', '/admin/auth/get', 'query', 'gw-auth-get'),
    rpc('gw-auth-delete', 'DELETE', '/admin/auth', 'body', 'gw-auth-delete'),
    rpc('gw-metrics-get', 'GET', '/admin/metrics', 'query', 'gw-metrics-get'),
    rpc('gw-metrics-series', 'GET', '/admin/metrics/series', 'query', 'gw-metrics-series'),
    rpc('gw-metrics-points', 'GET', '/admin/metrics/points', 'query', 'gw-metrics-points'),
    rpc('gw-metrics-summary', 'GET', '/admin/metrics/summary', 'query', 'gw-metrics-summary'),
    {
      name: 'gw-metrics-prometheus',
      method: 'GET',
      path: '/admin/metrics/prometheus',
      dataSource: 'query',
      topic: 'rlb-gateway-admin',
      action: 'gw-metrics-prometheus',
      mode: 'rpc',
      headers: { 'Content-Type': 'text/plain; version=0.0.4' },
    },
    rpc('gw-metrics-rollups', 'GET', '/admin/metrics/rollups', 'query', 'gw-metrics-rollups'),
    {
      name: 'gw-metrics-track',
      method: 'POST',
      path: '/admin/metrics/track',
      dataSource: 'body',
      topic: 'rlb-gateway-admin',
      action: 'gw-metrics-track',
      mode: 'event',
    },
    { name: 'gw-reload', method: 'POST', path: '/admin/reload', dataSource: 'body', topic: controlTopic, action: 'gw-reload', mode: 'event' },
    { name: 'gw-auth-reload', method: 'POST', path: '/admin/auth/reload', dataSource: 'body', topic: controlTopic, action: 'gw-auth-reload', mode: 'event' },
  ];
}
