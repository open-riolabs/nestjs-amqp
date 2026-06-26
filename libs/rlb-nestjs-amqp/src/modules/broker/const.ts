export const RLB_AMQP_BROKER_OPTIONS = 'RLB_AMQP_BROKER_OPTIONS';
export const RLB_AMQP_TOPIC_CONNECTION = 'RLB_AMQP_TOPIC_CONNECTION';
export const RLB_AMQP_APP_OPTIONS = 'RLB_AMQP_APP_OPTIONS';
export const RLB_AMQP_AUTH_OPTIONS = 'RLB_AMQP_AUTH_OPTIONS';
export const RLB_AMQP_GATEWAY_OPTIONS = 'RLB_AMQP_GATEWAY_OPTIONS';
export const RLB_BROKER_METHOD_METADATA_KEY = 'rlb-broker:method';
export const RLB_BROKER_HTTP_METADATA_KEY = 'rlb-broker:http';
export const RLB_BROKER_AUTH_METADATA_KEY = 'rlb-broker:auth';
export const RLB_BROKER_PARAM_METADATA_KEY = 'rlb-broker:param';

/** The ONLY control-topic action that forces the gateway to rebuild its HTTP routes. The control
 *  topic may carry other message types (e.g. microservice config signals); the gateway ignores
 *  everything except this action, so an HTTP-forced reload stays decoupled from that traffic. */
export const GW_RELOAD_ACTION = 'gw-reload';

/** Deliberate, SEPARATE control action that reloads the DB auth-providers into RAM (activating UI
 *  changes). Independent of GW_RELOAD_ACTION (routes) and never auto-fired on auth CRUD. */
export const GW_AUTH_RELOAD_ACTION = 'gw-auth-reload';

/** Route auto-discovery (a microservice announces its HTTP routes to the gateway). */
export const RLB_ROUTE_DISCOVERY_OPTIONS = 'RLB_ROUTE_DISCOVERY_OPTIONS';
/** Dedicated durable exchange microservices publish their route manifests to. */
export const ROUTE_DISCOVERY_EXCHANGE = 'rlb-route-discovery';
/** Durable, NON-exclusive shared work-queue the gateway(s) consume from (competing consumers). */
export const ROUTE_SYNC_QUEUE = 'rlb-route-sync';