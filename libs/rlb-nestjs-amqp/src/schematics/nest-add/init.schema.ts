import { Path } from '@angular-devkit/core';

export interface InitOptions {
  /**
   * The name of the service.
   */
  name?: string;
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
   * Enable gateway mode: wire ProxyModule/HttpModule, add the gateway section to
   * config.yaml and the WebSocket adapter to main.ts. Defaults to true.
   */
  gateway?: boolean;

  /**
   * Copy the Claude skill files into .claude/skills. Defaults to true.
   */
  skills?: boolean;
}