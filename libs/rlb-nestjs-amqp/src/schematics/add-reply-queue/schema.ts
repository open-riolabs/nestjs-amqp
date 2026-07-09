export interface AddReplyQueueOptions {
  /** Exchange whose RPC replies route to `queue` (the map key). Prompted when omitted. */
  exchange?: string;
  /** The reply queue name (the map value). Prompted when omitted. */
  queue?: string;
  /** Overwrite an existing mapping for this exchange (setIn is idempotent regardless). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
