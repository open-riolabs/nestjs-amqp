import { ExchangeType } from '../utils/broker-yaml.util';

export interface AddQueueOptions {
  /** Queue name (the key). Prompted when omitted. */
  name?: string;
  /** Exchange the queue binds to. Default: 'rlb'. */
  exchange?: string;
  /** routingKey (required — and defaulted to the queue name — when the exchange is a topic). */
  routingKey?: string;
  /** Emit `createQueueIfNotExists`. Default: true. */
  createIfNotExists?: boolean;
  /** options.durable. Default: true. */
  durable?: boolean;
  /** options.exclusive. Default: false. */
  exclusive?: boolean;
  /** options.autoDelete. Default: false. */
  autoDelete?: boolean;
  /** options.messageTtl (ms) — growth bound. */
  messageTtl?: number;
  /** options.maxLength — growth bound. */
  maxLength?: number;
  /** options.expires (ms) — unused-queue TTL. */
  expires?: number;
  /** Create the exchange when it is missing (default: prompt→false, or true when the flag is passed). */
  createExchange?: boolean;
  /** Type of the exchange created via createExchange. Default: 'direct'. */
  exchangeType?: ExchangeType;
  /** Update the entry when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
