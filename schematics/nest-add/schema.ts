export interface Schema {
  /** Enable gateway mode (ProxyModule/HttpModule + gateway YAML + WS adapter). */
  gateway: boolean;
  /** Path to the root module to modify. */
  module: string;
  /** Path to the bootstrap file. */
  main: string;
  /** Path of the YAML config file to create. */
  config: string;
  /** Copy the Claude skills into .claude/skills. */
  skills: boolean;
  /** Skip the package manager install task. */
  skipInstall: boolean;
}
