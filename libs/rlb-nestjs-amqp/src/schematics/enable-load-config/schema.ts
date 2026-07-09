export interface EnableLoadConfigOptions {
  /** Topic the gateway pulls DB-managed paths from. Default: 'rlb-gateway-admin'. */
  pathsTopic?: string;
  /** Action for the paths export. Default: 'gw-path-export'. */
  pathsAction?: string;
  /** Topic the gateway pulls DB-managed events from (optional; both events options required together). */
  eventsTopic?: string;
  /** Action for the events export (optional; both events options required together). */
  eventsAction?: string;
  /** Update the entries when they already exist (default: overwrite the scalar values). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
