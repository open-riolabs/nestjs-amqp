export interface EnableRetryOptions {
  /** Where the retry policy lives: broker-wide default or a single topic. Default: 'broker'. */
  scope?: 'broker' | 'topic';
  /** Topic name — required when scope=topic. */
  topic?: string;
  /** Bounded attempt count before the message is dead-lettered/dropped. Default: 5. */
  maxAttempts?: number;
  /** Delay between attempts, in ms. Default: 0. */
  delayMs?: number;
  /** What to do once attempts are exhausted. Default: 'dead-letter' when a DLX is set, else 'drop'. */
  onExhausted?: 'dead-letter' | 'drop';
  /** Dead-letter exchange to route exhausted messages to. */
  deadLetterExchange?: string;
  /** Optional routing key used when dead-lettering. */
  deadLetterRoutingKey?: string;
  /** Also declare the DLX in broker.exchanges (this schematic's main value-add). Default: true. */
  declareDlx?: boolean;
  /** Type of the declared DLX. Default: 'topic'. */
  dlxType?: 'direct' | 'topic' | 'fanout' | 'headers';
  /** Update the retry block when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
