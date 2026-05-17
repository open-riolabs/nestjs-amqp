import { Options } from "amqplib";
import { RabbitMQAlternateExchangeConfig } from "./rabbitmq.config";

export interface RabbitMQExchangeConfig {
  name: string;
  type?: string;
  createExchangeIfNotExists?: boolean;
  options?: Options.AssertExchange;
  /**
   * Per-exchange alternate exchange. Overrides the broker-level
   * `defaultAlternateExchange` for this exchange only. Accepts either:
   * - a string (just the name; the AE is asserted as a durable `fanout`)
   * - a full config object (you can attach a dedicated unroutable queue).
   *
   * The AE referenced here is automatically asserted by the lib BEFORE this
   * exchange, so you don't need to declare it separately in `exchanges`.
   *
   * Resolution priority (highest wins) per exchange:
   *   1. `options.alternateExchange` set explicitly by the user
   *   2. this `alternateExchange` field
   *   3. broker-level `defaultAlternateExchange`
   */
  alternateExchange?: string | RabbitMQAlternateExchangeConfig;
}

export interface RabbitMQExchangeBindingConfig {
  destination: string;
  source: string;
  pattern: string;
  args?: any;
}