import { ExchangeType } from '../utils/broker-yaml.util';

export interface AddExchangeOptions {
  /** Exchange name (the key). Prompted when omitted. */
  name?: string;
  /** direct | topic | fanout | headers. Default: direct. */
  type?: ExchangeType;
  /** Emit `createExchangeIfNotExists`. Default: true. */
  createIfNotExists?: boolean;
  /** options.durable. Default: true. */
  durable?: boolean;
  /** options.autoDelete. Default: false. */
  autoDelete?: boolean;
  /** options.internal. Default: false. */
  internal?: boolean;
  /** Also create a queue bound to this exchange. */
  withQueue?: boolean;
  /** Name of that queue. Default: the exchange name. */
  queueName?: string;
  /** routingKey for the bound queue (required when type=topic). Default: the queue name. */
  routingKey?: string;
  /** Update the entry when it already exists (default: leave it untouched). */
  overwrite?: boolean;
  /** Path to config.yaml (default: auto-detected, typically config/config.yaml). */
  config?: string;
}
