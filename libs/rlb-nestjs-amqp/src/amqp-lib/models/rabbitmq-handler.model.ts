import { Options } from "amqplib";
import { QueueOptions } from "../config/rabbitmq-queue.config";
import { AssertQueueErrorHandler, BatchMessageErrorHandler, MessageDeserializer, MessageErrorHandler, MessageHandlerErrorBehavior } from "../types";


export interface RequestOptions {
  exchange: string;
  routingKey: string;
  correlationId?: string;
  timeout?: number;
  payload?: any;
  headers?: any;
  expiration?: string | number;
  replyTo?: string;
  publishOptions?: Omit<
    Options.Publish,
    'replyTo' | 'correlationId' | 'headers' | 'expiration'
  >;
}

export interface MessageHandlerOptions {
  /**
   * You can use a handler config specified in module level.
   * Just use the same key name defined there.
   */
  name?: string;
  connection?: string;
  exchange?: string;
  routingKey?: string | string[];
  queue?: string;
  queueOptions?: QueueOptions;
  /**
   * @deprecated()
   * Legacy error handling behaviors. This will be overridden if the errorHandler property is set
   */
  errorBehavior?: MessageHandlerErrorBehavior;
  /**
   * A function that will be called if an error is thrown during processing of an incoming message
   */
  errorHandler?: MessageErrorHandler;
  /**
   * A function that will be called if an error is thrown during queue creation (i.e. during channel.assertQueue)
   */
  assertQueueErrorHandler?: AssertQueueErrorHandler;
  allowNonJsonMessages?: boolean;
  createQueueIfNotExists?: boolean;

  /**
   * Indicates whether responses to requests with a 'replyTo' header should be persistent.
   * @default false - By default, responses are not persistent unless this is set to true.
   */
  usePersistentReplyTo?: boolean;

  /**
   * This function is used to deserialize the received message.
   * If set, will override the module's default deserializer.
   */
  deserializer?: MessageDeserializer;

  /**
   * Enables consumer-side batching.
   */
  batchOptions?: {
    /**
     * The number of messages to accumulate before calling the message handler.
     *
     * This should be smaller than the channel prefetch.
     *
     * Defaults to 10 if provided value is less than 2.
     *
     * @default 10
     */
    size: number;

    /**
     * The time to wait, in milliseconds, for additional messages before returning a partial batch.
     *
     * Defaults to 200 if not provided or provided value is less than 1.
     *
     * @default 200
     */
    timeout?: number;

    /**
     * A function that will be called if an error is thrown during processing of an incoming message
     */
    errorHandler?: BatchMessageErrorHandler;
  };
}

export interface MessageOptions {
  exchange: string;
  routingKey: string;
}
