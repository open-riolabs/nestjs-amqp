import { Options } from "amqplib";

export interface RabbitMQQueueConfig {
  name: string;
  createQueueIfNotExists?: boolean;
  options?: Options.AssertQueue;
  exchange?: string;
  routingKey?: string | string[];
  bindQueueArguments?: any;
  /**
   * This property can be set to define custom consumer name for the queue.
   *
   * Consumer tag must be unique to one channel. You shoudld properly manage
   * channels and tags in your local space in order to avoid conflicts.
   *
   * @see {@link https://amqp-node.github.io/amqplib/channel_api.html#channel_consume|Channel API reference}
   */
  consumerTag?: string | undefined;
}

export interface QueueOptions {
  durable?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
  arguments?: any;
  messageTtl?: number;
  expires?: number;
  deadLetterExchange?: string;
  deadLetterRoutingKey?: string;
  maxLength?: number;
  maxPriority?: number;
  bindQueueArguments?: any;
  /**
   * Set this to the name of the channel you want to consume messages from to enable this feature.
   *
   * If channel does not exist or you haven't specified one, it will use the default channel.
   *
   * For channel to exist it needs to be created in module config.
   */
  channel?: string;

  consumerOptions?: Options.Consume;
}
