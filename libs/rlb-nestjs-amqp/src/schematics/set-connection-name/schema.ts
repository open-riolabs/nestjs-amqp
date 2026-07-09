export interface SetConnectionNameOptions {
  /** The LOGICAL connection name. Trimmed but NOT kebab-normalized. Prompted when omitted. */
  name?: string;
  /** Update the value when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
