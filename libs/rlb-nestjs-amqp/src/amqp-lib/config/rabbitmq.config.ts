import { ModuleMetadata, Type } from "@nestjs/common";
import { AmqpConnectionManagerOptions } from "amqp-connection-manager";
import { MessageDeserializer, MessageErrorHandler, MessageHandlerErrorBehavior, MessageSerializer, RabbitMQChannels, RabbitMQHandlers, RabbitMQUriConfig } from "../types";
import { RabbitMQExchangeBindingConfig, RabbitMQExchangeConfig } from "./rabbitmq-exchange.config";
import { RabbitMQQueueConfig } from "./rabbitmq-queue.config";

export interface RabbitMQConfig {
  uri: RabbitMQUriConfig;
  /**
   * Now specifies the default prefetch count for all channels.
   */
  prefetchCount?: number;
  exchanges?: RabbitMQExchangeConfig[];
  exchangeBindings?: RabbitMQExchangeBindingConfig[];
  queues?: RabbitMQQueueConfig[];
  defaultRpcTimeout?: number;
  defaultExchangeType?: string;
  defaultRpcErrorHandler?: MessageErrorHandler;
  defaultSubscribeErrorBehavior?: MessageHandlerErrorBehavior;
  connectionInitOptions?: ConnectionInitOptions;
  connectionManagerOptions?: AmqpConnectionManagerOptions;
  registerHandlers?: boolean;
  enableDirectReplyTo?: boolean;
  enableControllerDiscovery?: boolean;
  /**
   * You can optionally create channels which you consume messages from.
   *
   * By setting `prefetchCount` for a channel, you can manage message speeds of your various handlers on the same connection.
   */
  channels?: RabbitMQChannels;

  /**
   * You can pass a list with handler configs to use in the Subscription decorator
   */
  handlers?: RabbitMQHandlers;

  /**
   * You can set this property to define the default handler configuration to use
   * when using handlers.
   */
  defaultHandler?: string;

  /**
   * This function is used to deserialize the received message.
   */
  deserializer?: MessageDeserializer;

  /**
   * This function is used to serialize the message to be sent.
   */
  serializer?: MessageSerializer;

  replyQueues?: { [key: string]: string; };
}

export interface ConnectionInitOptions {
  /**
   * Determines whether the application should wait for a healthy connection to be established
   * before proceeding with operations.
   *
   * - When set to `true` (default), the application will block until a connection to the RabbitMQ broker
   *   is successfully established or a timeout occurs. The `timeout` value specifies the maximum
   *   time (in milliseconds) the application will wait before giving up.
   * - When set to `false`, the application will not wait for a connection and will proceed
   *   regardless of the connection state. Health checks will be skipped in this case.
   *
   * @default true - The application will wait for a healthy connection by default.
   */
  wait?: boolean;

  /**
   * Specifies how long (in milliseconds) the application should wait for a healthy connection
   * to be established when `wait` is set to `true`. If the connection is not established within
   * this time frame, an error will be thrown or suppressed based on the `reject` option.
   *
   * @default 5000 - The application will wait for up to N milliseconds before timing out.
   */
  timeout?: number;
  /**
   * Determines the behavior when a connection fails within the specified `timeout` period.
   *
   * - When set to `true` (default), the application will throw an error if a connection
   *   cannot be established within the timeout period.
   * - When set to `false`, the application will suppress the error and continue running,
   *   treating the failed connection as a non-blocking issue.
   *
   * @default true - The application will throw an error on timeout by default.
   */
  reject?: boolean;

  /**
   * When set to `true`, suppresses logging for connection failure events.
   *
   * Use this flag to prevent connection failure logs from being written,
   * which can be useful in non-critical environments or during specific operations
   * where connection issues are expected and do not require logging.
   *
   * @default false - Connection failure logs will be written by default.
   */
  skipConnectionFailedLogging?: boolean;
  /**
   * When set to `true`, suppresses logging for disconnection failure events.
   *
   * @default false - Disconnection failure logs will be written by default.
   */
  skipDisconnectFailedLogging?: boolean;
}

export interface RabbitMQChannelConfig {
  /**
   * Specifies prefetch count for the channel. If not specified will use the default one.
   */
  prefetchCount?: number;
  /**
   * Makes this channel the default for all handlers.
   *
   * If no channel has been marked as default, new channel will be created.
   */
  default?: boolean;
}

export interface RabbitMQModuleOptionsFactory {
  createRabbitMQModuleOptions(): Promise<RabbitMQConfig> | RabbitMQConfig;
}

export interface RabbitMQModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useClass?: Type<RabbitMQModuleOptionsFactory>;
  useExisting?: Type<RabbitMQModuleOptionsFactory>;
  useFactory?: (...args: any[]) => Promise<RabbitMQConfig> | RabbitMQConfig;
}