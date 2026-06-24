/** Single connection for this microservice (chatbot-ms style: one connection per ms). */
export const DATA_CONNECTION_NAME = 'gateway-2';

export const ACL_ACTION_MODEL = 'ACL_ACTION_MODEL';
export const ACL_ROLE_MODEL = 'ACL_ROLE_MODEL';
export const ACL_GRANT_MODEL = 'ACL_GRANT_MODEL';
export const HTTP_PATH_MODEL = 'HTTP_PATH_MODEL';
export const AUTH_PROVIDER_MODEL = 'AUTH_PROVIDER_MODEL';
export const HTTP_METRIC_MODEL = 'HTTP_METRIC_MODEL';
/** Raw per-request metric data points (time-series source). */
export const HTTP_METRIC_POINT_MODEL = 'HTTP_METRIC_POINT_MODEL';
/** Downsampled, pre-aggregated metric rollup buckets (long-term trends). */
export const METRIC_ROLLUP_MODEL = 'METRIC_ROLLUP_MODEL';
/** Route auto-discovery journal (one row per added/updated/removed/collision event). */
export const ROUTE_SYNC_LOG_MODEL = 'ROUTE_SYNC_LOG_MODEL';
