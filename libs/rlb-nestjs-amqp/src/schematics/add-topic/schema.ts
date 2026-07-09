import { TopicMode } from '../utils/broker-yaml.util';

export interface AddTopicOptions {
  /** Topic name (the key). Prompted when omitted. */
  name?: string;
  /** rpc | handle | broadcast | event. Default: rpc. */
  mode?: TopicMode;
  /** Queue the topic consumes (required for rpc/handle). */
  queue?: string;
  /** Exchange the topic uses. Default: 'rlb'. */
  exchange?: string;
  /** routingKey (required — and defaulted — when the exchange is a topic). */
  routingKey?: string;
  /** errorBehavior: ack | nack | requeue. */
  errorBehavior?: 'ack' | 'nack' | 'requeue';
  /** retry.maxAttempts. */
  retryMaxAttempts?: number;
  /** retry.delayMs. */
  retryDelayMs?: number;
  /** retry.onExhausted: dead-letter | drop. */
  retryOnExhausted?: 'dead-letter' | 'drop';
  /** options.mandatory. */
  mandatory?: boolean;
  /** options.persistent. */
  persistent?: boolean;
  /** toObservable. */
  toObservable?: boolean;
  /** Create the queue/exchange dependencies when missing. Default: true. */
  createDeps?: boolean;
  /** Update the entry when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
