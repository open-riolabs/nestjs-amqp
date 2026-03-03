import { Options } from "amqplib";

export interface RabbitMQExchangeConfig {
  name: string;
  type?: string;
  createExchangeIfNotExists?: boolean;
  options?: Options.AssertExchange;
}

export interface RabbitMQExchangeBindingConfig {
  destination: string;
  source: string;
  pattern: string;
  args?: any;
}