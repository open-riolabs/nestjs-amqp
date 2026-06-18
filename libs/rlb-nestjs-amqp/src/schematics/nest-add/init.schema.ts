import { Path } from '@angular-devkit/core';

export interface InitOptions {
  /**
   * The name of the service.
   */
  name?: string;
  /**
   * The name of the project (from the workspace).
   */
  project?: string;
  /**
   * The path to create the service.
   */
  path?: string;
  /**
   * The path to insert the service declaration.
   */
  module?: Path;
  /**
   * Directive to insert declaration in module.
   */
  skipImport?: boolean;
  /**
   * Metadata name affected by declaration insertion.
   */
  metadata?: string;
  /**
   * Nest element type name
   */
  type?: string;
  /**
   * Application language.
   */
  language?: string;
  /**
   * The source root path
   */
  sourceRoot?: string;
  /**
   * Specifies if a spec file is generated.
   */
  spec?: boolean;
  /**
   * Specifies the file suffix of spec files.
   * @default "spec"
   */
  specFileSuffix?: string;
  /**
   * Flag to indicate if a directory is created.
   */
  flat?: boolean;

  prefix?: string;

  /**
   * Create a gateway (HTTP/WebSocket) configuration: wire ProxyModule/HttpModule, the WebSocket
   * adapter in main.ts and the `gateway:` section in config.yaml. When omitted it is prompted
   * interactively; non-interactive runs default to false (a plain AMQP microservice).
   */
  gatewayConfig?: boolean;

  /**
   * Features to include. With gatewayConfig=true: 'acl', 'gateway-admin', 'route-reception'.
   * With gatewayConfig=false: 'auto-config-publish'. Prompted interactively when omitted.
   */
  features?: string[];

  /** Main AMQP exchange backing the ACL / gateway-admin queues. Default: 'rlb'. */
  exchange?: string;
  /** Queue backing the (fixed) rlb-acl topic. Default: 'rlb-acl'. */
  aclQueue?: string;
  /** Queue backing the (fixed) rlb-gateway-admin topic. Default: 'rlb-gateway-admin'. */
  adminQueue?: string;
  /** Broadcast control/reload topic name. Default: 'rlb-gateway-control'. */
  controlTopic?: string;
  /** Route auto-discovery fanout exchange (must match publisher + gateway). Default: 'rlb-route-discovery'. */
  routeExchange?: string;
  /** Route-sync durable queue (gateway consumer side). Default: 'rlb-route-sync'. */
  routeQueue?: string;
  /** Service name for route auto-publish (route ownership + connection_name). Default: project name. */
  serviceName?: string;

  /**
   * Copy the Claude skill files into .claude/skills. Defaults to true.
   */
  skills?: boolean;
}