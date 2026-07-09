export interface AddMetricsTopicOptions {
  /** Metrics topic name. Default: 'rlb-gateway-metrics'. */
  topic?: string;
  /** Queue backing the topic. Default: the topic value. */
  queue?: string;
  /** Exchange the queue binds to. Default: 'rlb'. */
  exchange?: string;
  /** Queue options.messageTtl (ms). Default: 3600000. */
  messageTtl?: number;
  /** Queue options.maxLength. Default: 500000. */
  maxLength?: number;
  /** Action the gateway emits metrics with. Default: 'gw-metrics-track'. */
  action?: string;
  /** Update the entries when they already exist (default: leave them untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
