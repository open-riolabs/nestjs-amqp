export interface AddExchangeBindingOptions {
  /** Source exchange (mirrors RabbitMQExchangeBindingConfig.source). Prompted when omitted. */
  source?: string;
  /** Destination exchange (mirrors RabbitMQExchangeBindingConfig.destination). */
  destination?: string;
  /** Binding pattern / routing key (mirrors RabbitMQExchangeBindingConfig.pattern). */
  pattern?: string;
  /** Optional binding arguments (mirrors RabbitMQExchangeBindingConfig.args). */
  args?: Record<string, unknown>;
  /** Update the entry when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
