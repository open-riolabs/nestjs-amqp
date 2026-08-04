import { Inject, Logger, LoggerService, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { RLB_AMQP_BROKER_OPTIONS } from '@open-rlb/nestjs-amqp/modules/broker/const';
import { AmqpConnectionManager, ChannelWrapper, connect, } from 'amqp-connection-manager';
import { Channel, ConfirmChannel, Connection, ConsumeMessage, credentials, Options, } from 'amqplib';
import { randomUUID } from 'crypto';
import { EMPTY, interval, lastValueFrom, race, Subject, throwError, } from 'rxjs';
import { catchError, filter, first, map, take, timeout } from 'rxjs/operators';
import { defaultAssertQueueErrorHandler } from '..';
import { RabbitMQQueueConfig } from '../config/rabbitmq-queue.config';
import { ConnectionInitOptions, RabbitMQAlternateExchangeConfig, RabbitMQChannelConfig, RabbitMQConfig } from '../config/rabbitmq.config';
import { CorrelationMessage } from '../models/correlation-message.model';
import { ChannelNotAvailableError, ConnectionNotAvailableError, MessageDeserializationError, NullMessageError, RpcTimeoutError, } from '../models/errors.model';
import { Nack } from '../models/nack.model';
import { MessageHandlerOptions, RequestOptions } from '../models/rabbitmq-handler.model';
import { SubscriptionResult } from '../models/subscription-result.model';
import { ConsumeOptions, Consumer, ConsumerHandler, ConsumerTag, DIRECT_REPLY_QUEUE, MessageDeserializer, MessageHandlerErrorBehavior, RpcSubscriberHandler, SubscriberHandler } from '../types';
import { getHandlerForLegacyBehavior } from './errorBehaviors';
import { createRetryErrorHandler, DEFAULT_RETRY_POLICY } from './retry-policy';
import { converUriConfigObjectsToUris, matchesRoutingKey, merge, validateRabbitMqUris } from './utils';

const defaultConfig = {
  name: 'default',
  prefetchCount: 10,
  defaultExchangeType: 'topic',
  // NOTE: defaultRpcErrorHandler / defaultSubscribeErrorBehavior deliberately have NO
  // built-in default anymore. Their absence means "the user configured nothing" and the
  // bounded retry policy applies (see resolveErrorHandler) — the old implicit REQUEUE
  // default hot-looped poison messages forever. Explicitly configured values still win.
  exchanges: [],
  exchangeBindings: [],
  queues: [],
  defaultRpcTimeout: 10000,
  connectionInitOptions: {
    wait: true,
    timeout: 5000,
    reject: true,
    skipConnectionFailedLogging: false,
    skipDisconnectFailedLogging: false,
  },
  connectionManagerOptions: {},
  registerHandlers: true,
  enableDirectReplyTo: true,
  channels: {},
  handlers: {},
  defaultHandler: '',
  enableControllerDiscovery: false,
};

export class AmqpConnection implements OnApplicationShutdown, OnModuleInit {
  private readonly messageSubject = new Subject<CorrelationMessage>();
  private readonly logger: LoggerService = new Logger(AmqpConnection.name);
  private readonly initialized = new Subject<void>();
  private _managedConnection!: AmqpConnectionManager;
  /**
   * Will now specify the default managed channel.
   */
  private _managedChannel!: ChannelWrapper;
  private _managedChannels: Record<string, ChannelWrapper> = {};
  /**
   * Will now specify the default channel.
   */
  private _channel!: ConfirmChannel;
  private _channels: Record<string, ConfirmChannel> = {};
  private _connection?: Connection;

  private _consumers: Record<ConsumerTag, ConsumerHandler<unknown, unknown>> = {};

  private readonly outstandingMessageProcessing = new Set<Promise<void>>();

  constructor(
    @Inject(RLB_AMQP_BROKER_OPTIONS) private readonly config: RabbitMQConfig,
  ) {
    if (config == undefined) {
      this.logger.log('RabbitMQ config not provided, skipping connection initialization.');
      return undefined;
    }
    this.config = {
      deserializer: (message) => JSON.parse(message.toString()),
      serializer: (value) => Buffer.from(JSON.stringify(value)),
      ...defaultConfig,
      ...config,
      replyQueues: config.replyQueues || {},
    };

    // NOTE: the per-instance uniquification of `connection_name` happens in
    // BrokerModule.withInstanceUniqueConnectionName, on the shared config object,
    // BEFORE it is injected here — so connection, broadcast queues and WS queues
    // all derive their names from the same already-unique value.
    const cred = config.connectionManagerOptions.connectionOptions.credentials as {
      mechanism: string; username: string; password: string; response: () => Buffer;
    };
    if (cred && cred.mechanism?.toLowerCase() === 'plain') {
      cred.response = credentials.plain(cred.username, cred.password).response;
    }
    if (cred && cred.mechanism?.toLowerCase() === 'external') {
      cred.response = credentials.external().response;
    }
    if (cred && cred.mechanism?.toLowerCase() === 'amqplain') {
      cred.response = credentials.amqplain(cred.username, cred.password).response;
    }
    config.uri = converUriConfigObjectsToUris(config.uri);
    validateRabbitMqUris(config.uri);
  }

  async onModuleInit() {
    await this.init();
    this.logger.log('Successfully connected to RabbitMQ');
  }

  get channel(): Channel {
    if (!this._channel) throw new ChannelNotAvailableError();
    return this._channel;
  }

  get connection(): Connection {
    if (!this._connection) throw new ConnectionNotAvailableError();
    return this._connection;
  }

  get managedChannel(): ChannelWrapper {
    return this._managedChannel;
  }

  get managedConnection(): AmqpConnectionManager {
    return this._managedConnection;
  }

  get configuration() {
    return this.config;
  }

  get channels() {
    return this._channels;
  }

  get managedChannels() {
    return this._managedChannels;
  }

  get connected() {
    return this._managedConnection.isConnected();
  }

  public async init(): Promise<void> {
    const options: Required<ConnectionInitOptions> = {
      ...defaultConfig.connectionInitOptions,
      ...this.config.connectionInitOptions,
    };

    const {
      skipConnectionFailedLogging,
      skipDisconnectFailedLogging,
      wait,
      timeout: timeoutInterval,
      reject,
    } = options;

    const p = this.initCore(
      wait,
      skipConnectionFailedLogging,
      skipDisconnectFailedLogging,
    );

    if (!wait) {
      this.logger.log(
        `Skipping connection health checks as 'wait' is disabled. The application will proceed without verifying a healthy RabbitMQ connection.`,
      );

      return p;
    }

    return lastValueFrom(
      this.initialized.pipe(
        take(1),
        timeout({
          each: timeoutInterval,
          with: () =>
            throwError(
              () =>
                new Error(
                  `Failed to connect to a RabbitMQ broker within a timeout of ${timeoutInterval}ms`,
                ),
            ),
        }),
        catchError((err) => (reject ? throwError(() => err) : EMPTY)),
      ),
    );
  }

  public async request<T>(requestOptions: RequestOptions): Promise<T> {
    const correlationId = requestOptions.correlationId || randomUUID();
    const requestId = requestOptions?.headers?.['X-Request-ID'];
    const timeout = requestOptions.timeout || this.config.defaultRpcTimeout;
    const payload = requestOptions.payload || {};

    const response$ = this.messageSubject.pipe(
      filter((x) =>
        requestId
          ? x.correlationId === correlationId && x.requestId === requestId
          : x.correlationId === correlationId,
      ),
      map((x) => x.message as T),
      first(),
    );

    const timeout$ = interval(timeout).pipe(
      first(),
      map(() => {
        throw new RpcTimeoutError(
          timeout,
          requestOptions.exchange,
          requestOptions.routingKey,
        );
      }),
    );

    // Wrapped lastValueFrom(race(response$, timeout$)) in a Promise to properly catch
    // timeout errors. Without this, the timeout could trigger while publish() was
    // still running, causing an unhandled rejection and crashing the application.
    const [result] = await Promise.all([
      lastValueFrom(race(response$, timeout$)),
      this.publish(
        requestOptions.exchange,
        requestOptions.routingKey,
        payload,
        {
          ...requestOptions.publishOptions,
          replyTo: requestOptions.replyTo || DIRECT_REPLY_QUEUE,
          correlationId,
          headers: requestOptions.headers,
          expiration: requestOptions.expiration,
        },
      ),
    ]);

    return result;
  }

  public async createSubscriber<T>(
    handler: SubscriberHandler<T>,
    msgOptions: MessageHandlerOptions,
    originalHandlerName: string,
    consumeOptions?: ConsumeOptions,
  ): Promise<SubscriptionResult> {
    return this.consumerFactory(msgOptions, (channel, channelMsgOptions) =>
      this.setupSubscriberChannel<T>(
        handler,
        channelMsgOptions,
        channel,
        originalHandlerName,
        consumeOptions,
      ),
    );
  }

  public async createRpc<T, U>(
    handler: RpcSubscriberHandler<T, U>,
    rpcOptions: MessageHandlerOptions,
  ): Promise<SubscriptionResult> {
    return this.consumerFactory(rpcOptions, (channel, channelRpcOptions) =>
      this.setupRpcChannel<T, U>(handler, channelRpcOptions, channel),
    );
  }

  public async setupRpcChannel<T, U>(
    handler: RpcSubscriberHandler<T, U>,
    rpcOptions: MessageHandlerOptions,
    channel: ConfirmChannel,
  ): Promise<ConsumerTag> {
    const queue = await this.setupQueue(rpcOptions, channel);
    const errorHandler = this.resolveErrorHandler(rpcOptions, queue, 'rpc');

    const { consumerTag }: { consumerTag: ConsumerTag; } = await channel.consume(
      queue,
      this.wrapConsumer(async (msg) => {
        try {
          if (msg == null) {
            throw new NullMessageError();
          }

          if (
            !matchesRoutingKey(msg.fields.routingKey, rpcOptions.routingKey)
          ) {
            channel.nack(msg, false, false);
            this.logger.error(
              'Received message with invalid routing key: ' +
              msg.fields.routingKey,
            );
            return;
          }

          const result = this.tryDeserializeMessage<T>(msg, rpcOptions);
          const response = await handler(result.message, msg, result.headers);

          if (response instanceof Nack) {
            channel.nack(msg, false, response.requeue);
            return;
          }

          const { replyTo, correlationId, expiration, headers } =
            msg.properties;
          if (replyTo) {
            await this.publish('', replyTo, response, {
              correlationId,
              expiration,
              headers,
              persistent: rpcOptions.usePersistentReplyTo ?? false,
            });
          }
          channel.ack(msg);
        } catch (e) {
          if (msg == null) {
            return;
          } else {
            try {
              await errorHandler(channel, msg, e);
            } catch (handlerError) {
              // See setupSubscriberChannel: a throwing error handler must not become an
              // unhandled rejection (process crash); redelivery covers the message.
              this.logger.error(`Error handler failed for queue '${queue}': ${(handlerError as Error)?.message}`);
            }
          }
        }
      }),
      rpcOptions?.queueOptions?.consumerOptions,
    );

    this.registerConsumerForQueue({
      type: 'rpc',
      consumerTag,
      handler,
      msgOptions: rpcOptions,
      channel,
    });

    return consumerTag;
  }

  public publish(
    exchange: string,
    routingKey: string,
    message: any,
    options?: Options.Publish,
  ): Promise<boolean> {
    let buffer: Buffer;
    if (message instanceof Buffer) {
      buffer = message;
    } else if (message instanceof Uint8Array) {
      buffer = Buffer.from(message);
    } else if (message != null) {
      buffer = this.config.serializer(message);
    } else {
      buffer = Buffer.alloc(0);
    }

    return this._managedChannel.publish(exchange, routingKey, buffer, options);
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.verbose?.('Closing AMQP Connections');
    await this.close();
  }

  private async initCore(
    wait = false,
    skipConnectionFailedLogging = false,
    skipDisconnectFailedLogging = false,
  ): Promise<void> {
    this.logger.log(`Trying to connect to RabbitMQ broker`);

    this._managedConnection = connect(
      Array.isArray(this.config.uri) ? this.config.uri : [this.config.uri],
      this.config.connectionManagerOptions
    );

    this._managedConnection.on('connect', ({ connection }) => {
      this._connection = connection;
      this.logger.log(`Successfully connected to RabbitMQ broker`);
    });

    // Logging disconnections should only be able if consumers
    // do not skip it. We may be able to merge with the `skipConnectionFailedLogging`
    // option in the future.
    if (!skipDisconnectFailedLogging) {
      this._managedConnection.on('disconnect', ({ err }) => {
        this.logger.error(`Disconnected from RabbitMQ broker`, err?.stack);
      });
    }

    // Certain consumers might want to skip "connectionFailed" logging
    // therefore this option will allow us to conditionally register this event consumption
    if (!skipConnectionFailedLogging) {
      this._managedConnection.on('connectFailed', ({ err }) => {
        const message = `Connection Failed: Unable to establish a connection to the broker. Check the broker's availability, network connectivity, and configuration.`;

        if (!wait) {
          // Lower the log severity if 'wait' is disabled, as the application continues to function.
          this.logger.warn(message);
          if (err?.stack) {
            this.logger.debug?.(`Stack trace: ${err.stack}`);
          }
        } else {
          // Log as an error if 'wait' is enabled, as this impacts the connection health.
          this.logger.error(message, err?.stack);
        }
      });
    }

    const defaultChannel: { name: string; config: RabbitMQChannelConfig; } = {
      name: this.config.connectionManagerOptions?.connectionOptions?.clientProperties?.connection_name || AmqpConnection.name,
      config: {
        prefetchCount: this.config.prefetchCount,
        default: true,
      },
    };

    await Promise.all([
      Promise.all(
        Object.keys(this.config.channels).map(async (channelName) => {
          const config = this.config.channels[channelName];
          // Only takes the first channel specified as default so other ones get created.
          if (defaultChannel.name === AmqpConnection.name && config.default) {
            defaultChannel.name = channelName;
            defaultChannel.config.prefetchCount =
              config.prefetchCount || this.config.prefetchCount;
            return;
          }

          return this.setupManagedChannel(channelName, {
            ...config,
            default: false,
          });
        }),
      ),
      this.setupManagedChannel(defaultChannel.name, defaultChannel.config),
    ]);
  }

  private setupManagedChannel(name: string, config: RabbitMQChannelConfig) {
    const channel = this._managedConnection.createChannel({
      name,
    });

    this._managedChannels[name] = channel;

    if (config.default) {
      this._managedChannel = channel;
    }

    channel.on('connect', () =>
      this.logger.log(`Successfully connected a RabbitMQ channel "${name}"`),
    );

    channel.on('error', (err, { name }) =>
      this.logger.error(
        `Failed to setup a RabbitMQ channel - name: ${name} / error: ${err.message} ${err.stack}`,
      ),
    );

    channel.on('close', () =>
      this.logger.log(`Successfully closed a RabbitMQ channel "${name}"`),
    );
    return channel.addSetup((c) => this.setupInitChannel(c, name, config));
  }

  private async setupInitChannel(
    channel: ConfirmChannel,
    name: string,
    config: RabbitMQChannelConfig,
  ): Promise<void> {
    this._channels[name] = channel;

    channel.removeAllListeners('return');
    channel.on('return', (msg: ConsumeMessage) => {
      const { exchange, routingKey } = msg.fields as any;
      const isDirectReplyToArtifact =
        exchange === '' &&
        typeof routingKey === 'string' &&
        routingKey.startsWith('amq.rabbitmq.reply-to');
      if (isDirectReplyToArtifact) {
        return;
      }
      this.logger.warn(
        `Unroutable message returned by broker (channel "${name}") - exchange: "${exchange}" routingKey: "${routingKey}". ` +
        `Check that a queue is bound to the exchange for this routing key, or configure 'defaultAlternateExchange' to capture them.`,
      );
      try {
        this.config.onUnroutableMessage?.(msg);
      } catch (e) {
        this.logger.error(`onUnroutableMessage callback threw: ${(e as Error)?.message}`);
      }
    });
    await channel.prefetch(config.prefetchCount || this.config.prefetchCount);

    if (config.default) {
      this._channel = channel;

      // Resolve all referenced alternate exchanges (broker-level default and
      // per-exchange overrides). De-duplicated by AE name; the first occurrence
      // wins (so a per-exchange config with the same name as the global one
      // is treated as the same AE).
      const globalAe = this.normalizeAlternateExchange(this.config.defaultAlternateExchange);
      const aeRegistry = new Map<string, RabbitMQAlternateExchangeConfig>();
      if (globalAe) aeRegistry.set(globalAe.name, globalAe);
      for (const x of this.config.exchanges) {
        const perEx = this.normalizeAlternateExchange(x.alternateExchange);
        if (perEx && !aeRegistry.has(perEx.name)) aeRegistry.set(perEx.name, perEx);
      }

      // All AEs must exist BEFORE any exchange that references them.
      for (const ae of aeRegistry.values()) {
        await this.setupAlternateExchange(channel, ae);
      }

      // Always assert exchanges & rpc queue in default channel.
      // AE resolution per exchange (highest priority first):
      //   1. user-set options.alternateExchange
      //   2. per-exchange `alternateExchange` field
      //   3. broker-level `defaultAlternateExchange`
      await Promise.all(
        this.config.exchanges.map((x) => {
          const { createExchangeIfNotExists = true } = x;

          if (createExchangeIfNotExists) {
            const options: Options.AssertExchange = { ...(x.options || {}) };
            if (!options.alternateExchange) {
              const perEx = this.normalizeAlternateExchange(x.alternateExchange);
              const effectiveAe = perEx ?? globalAe;
              if (effectiveAe) options.alternateExchange = effectiveAe.name;
            }
            return channel.assertExchange(
              x.name,
              x.type || this.config.defaultExchangeType,
              options,
            );
          }
          return channel.checkExchange(x.name);
        }),
      );

      await Promise.all(
        this.config.exchangeBindings.map((exchangeBinding) =>
          channel.bindExchange(
            exchangeBinding.destination,
            exchangeBinding.source,
            exchangeBinding.pattern,
            exchangeBinding.args,
          ),
        ),
      );
      if (this.config.queues) {
        await this.setupQueuesWithBindings(channel, this.config.queues);
      }
      if (this.config.enableDirectReplyTo) {
        await channel.consume(DIRECT_REPLY_QUEUE, (msg) => this.processDirectReplyToMessage(msg), { noAck: true });

        for (const replyQueue of Object.values(this.config.replyQueues || {})) {
          await channel.consume(replyQueue, (msg) => this.processDirectReplyToMessage(msg), { noAck: true });
        }
      }

      this.initialized.next();
    }
  }

  private async setupQueuesWithBindings(
    channel: ConfirmChannel,
    queues: RabbitMQQueueConfig[],
  ) {
    await Promise.all(
      queues.map(async (configuredQueue) => {
        const { name, options, bindQueueArguments, ...rest } = configuredQueue;
        const queueOptions = {
          ...options,
          ...(bindQueueArguments !== undefined && { bindQueueArguments }),
        };

        await this.setupQueue(
          {
            ...rest,
            ...(name !== undefined && { queue: name }),
            queueOptions,
          },
          channel,
        );
      }),
    );
  }

  private processDirectReplyToMessage(msg: ConsumeMessage) {
    if (msg == null) {
      return;
    }

    // A reply with no correlationId cannot be matched to any pending request; dropping it here
    // avoids a `.toString()` on undefined throwing inside this noAck consume callback (which,
    // being noAck, has already lost the message) and taking down the reply pump.
    const correlationId = msg.properties?.correlationId;
    if (correlationId == null) {
      this.logger.warn('Received a direct-reply message with no correlationId; dropping it.');
      return;
    }

    // Check that the Buffer has content, before trying to parse it
    const message =
      msg.content.length > 0
        ? this.config.deserializer(msg.content, msg)
        : undefined;

    const correlationMessage: CorrelationMessage = {
      correlationId: correlationId.toString(),
      requestId: msg.properties?.headers?.['X-Request-ID']?.toString(),
      message: message,
    };

    this.messageSubject.next(correlationMessage);
  }
  ////

  /** Once true (graceful drain), no consumer may be (re)created for the process lifetime. */
  private consumersCanceled = false;

  private async consumerFactory(
    msgOptions: MessageHandlerOptions,
    setupFunction: (channel: ConfirmChannel, msgOptions: MessageHandlerOptions,) => Promise<string>
  ): Promise<SubscriptionResult> {
    if (this.consumersCanceled) {
      throw new Error(`Consumers were canceled (graceful drain): refusing to subscribe to queue '${msgOptions.queue}'`);
    }
    return new Promise((res) => {
      // Use globally configured consumer tag.
      // See https://github.com/golevelup/nestjs/issues/904

      const queueConfig = this.config.queues.find((q) => q.name === msgOptions.queue);

      const consumerTagConfig: Partial<MessageHandlerOptions> =
        queueConfig?.consumerTag
          ? {
            queueOptions: {
              consumerOptions: {
                consumerTag: queueConfig.consumerTag,
              },
            },
          }
          : {};

      this.selectManagedChannel(msgOptions?.queueOptions?.channel).addSetup(
        async (channel: ConfirmChannel) => {
          // Setup functions re-run on EVERY reconnect: after a graceful drain the
          // consumer must NOT resurrect (messages would be consumed by an instance
          // whose handlers are already unregistered — and silently lost).
          if (this.consumersCanceled) {
            return;
          }
          const consumerTag = await setupFunction(
            channel,
            // Override global configuration by merging the global/default
            // tag configuration with the parametized msgOption.

            merge(consumerTagConfig, msgOptions),
          );
          res({ consumerTag });
        },
      );
    });
  }

  /**
   * Wrap a consumer with logic that tracks the outstanding message processing to
   * be able to wait for them on shutdown.
   */
  private wrapConsumer(consumer: Consumer): Consumer {
    return (msg: ConsumeMessage | null) => {
      const messageProcessingPromise = Promise.resolve(consumer(msg));
      this.outstandingMessageProcessing.add(messageProcessingPromise);
      messageProcessingPromise.finally(() =>
        this.outstandingMessageProcessing.delete(messageProcessingPromise),
      );
    };
  }

  /** Wait-queues already asserted in this process (re-asserted on reconnect via addSetup). */
  private readonly assertedRetryWaitQueues = new Set<string>();

  /**
   * TTL wait-queue for delayed retries: a copy parked here for `delayMs` is dead-lettered
   * back to the work queue through the default exchange. `expires` self-cleans the queue
   * when a policy changes or the instance goes away (safe: messages leave after
   * `delayMs` < `expires`).
   */
  private async assertRetryWaitQueue(waitQueue: string, delayMs: number, targetQueue: string): Promise<void> {
    if (this.assertedRetryWaitQueues.has(waitQueue)) return;
    this.assertedRetryWaitQueues.add(waitQueue);
    await this._managedChannel.addSetup((channel: ConfirmChannel) =>
      channel.assertQueue(waitQueue, {
        durable: true,
        messageTtl: delayMs,
        deadLetterExchange: '',
        deadLetterRoutingKey: targetQueue,
        expires: delayMs + 60_000,
      }),
    );
  }

  /**
   * Error-handler resolution for a consumer, most specific first:
   * subscription `errorHandler` > subscription `retry` > subscription legacy `errorBehavior` >
   * connection `retry` > configured `defaultRpcErrorHandler` (rpc only) > configured
   * `defaultSubscribeErrorBehavior` > built-in bounded retry (5 attempts, no delay, drop).
   * The old implicit infinite-REQUEUE default is gone: it hot-looped poison messages forever.
   * Legacy behaviors are case-normalized ('ack' → ACK) — YAML configs use lowercase.
   */
  private resolveErrorHandler(options: MessageHandlerOptions, queue: string, kind: 'rpc' | 'subscribe') {
    const legacy = (behavior: MessageHandlerErrorBehavior) =>
      getHandlerForLegacyBehavior(String(behavior).toUpperCase() as MessageHandlerErrorBehavior);
    const retry = (policy: typeof options.retry) =>
      createRetryErrorHandler(queue, policy, {
        publish: this.publish.bind(this),
        assertRetryWaitQueue: this.assertRetryWaitQueue.bind(this),
        logger: {
          warn: (m: string) => this.logger.warn(m),
          error: (m: string) => this.logger.error(m),
        },
      }, options.topic);
    if (options.errorHandler) return options.errorHandler;
    if (options.retry) return retry(options.retry);
    if (options.errorBehavior) return legacy(options.errorBehavior);
    if (this.config.retry) return retry(this.config.retry);
    if (kind === 'rpc' && this.config.defaultRpcErrorHandler) return this.config.defaultRpcErrorHandler;
    if (this.config.defaultSubscribeErrorBehavior) return legacy(this.config.defaultSubscribeErrorBehavior);
    return retry(DEFAULT_RETRY_POLICY);
  }

  /** Deserialization failures get a typed, NON-retriable error (see retry policy). */
  private tryDeserializeMessage<T>(
    msg: ConsumeMessage,
    options: { allowNonJsonMessages?: boolean; deserializer?: MessageDeserializer },
  ) {
    try {
      return this.deserializeMessage<T>(msg, options);
    } catch (e) {
      throw new MessageDeserializationError(e);
    }
  }

  private async setupSubscriberChannel<T>(
    handler: SubscriberHandler<T>,
    msgOptions: MessageHandlerOptions,
    channel: ConfirmChannel,
    originalHandlerName = 'unknown',
    consumeOptions?: ConsumeOptions,
  ): Promise<ConsumerTag> {
    const queue = await this.setupQueue(msgOptions, channel);
    const errorHandler = this.resolveErrorHandler(msgOptions, queue, 'subscribe');

    const { consumerTag }: { consumerTag: ConsumerTag; } = await channel.consume(
      queue,
      this.wrapConsumer(async (msg) => {
        try {
          if (msg === null) {
            throw new NullMessageError();
          }

          const result = this.tryDeserializeMessage<T>(msg, msgOptions);
          const response = await handler(result.message, msg, result.headers);

          if (response instanceof Nack) {
            channel.nack(msg, false, response.requeue);
            return;
          }

          // developers should be responsible to avoid subscribers that return therefore
          // the request will be acknowledged
          if (response as any) {
            this.logger.warn(
              `Received response: [${this.config.serializer(
                response,
              )}] from subscribe handler [${originalHandlerName}]. Subscribe handlers should only return void`,
            );
          }

          channel.ack(msg);
        } catch (e) {
          if (msg === null) {
            return;
          } else {
            try {
              await errorHandler(channel, msg, e);
            } catch (handlerError) {
              // An error handler that throws (e.g. nack on a channel that died mid-flight)
              // would otherwise become an unhandled rejection and crash the process; the
              // unacked message is redelivered on reconnect anyway.
              this.logger.error(`Error handler failed for queue '${queue}': ${(handlerError as Error)?.message}`);
            }
          }
        }
      }),
      consumeOptions,
    );

    this.registerConsumerForQueue({
      type: 'subscribe',
      consumerTag,
      handler,
      msgOptions,
      channel,
    });

    return consumerTag;
  }

  private deserializeMessage<T>(
    msg: ConsumeMessage,
    options: {
      allowNonJsonMessages?: boolean;
      deserializer?: MessageDeserializer;
    },
  ) {
    let message: T | undefined = undefined;
    let headers: any = undefined;
    const deserializer = options.deserializer || this.config.deserializer;
    if (msg.content) {
      if (options.allowNonJsonMessages) {
        try {
          message = deserializer(msg.content, msg) as T;
        } catch {
          // Pass raw message since flag `allowNonJsonMessages` is set
          // Casting to `any` first as T doesn't have a type
          message = msg.content.toString() as any as T;
        }
      } else {
        message = deserializer(msg.content, msg) as T;
      }
    }

    if (msg.properties && msg.properties.headers) {
      headers = msg.properties.headers;
    }

    return { message, headers };
  }

  private async setupQueue(
    subscriptionOptions: MessageHandlerOptions,
    channel: ConfirmChannel,
  ): Promise<string> {
    const {
      exchange,
      routingKey,
      createQueueIfNotExists = true,
      assertQueueErrorHandler = defaultAssertQueueErrorHandler,
      queueOptions,
      queue: queueName = '',
    } = subscriptionOptions;

    let actualQueue: string;

    if (createQueueIfNotExists) {
      try {
        const { queue } = await channel.assertQueue(queueName, queueOptions);
        actualQueue = queue;
      } catch (error) {
        actualQueue = await assertQueueErrorHandler(
          channel,
          queueName,
          queueOptions,
          error,
        );
      }
    } else {
      const { queue } = await channel.checkQueue(
        subscriptionOptions.queue || '',
      );
      actualQueue = queue;
    }

    let bindQueueArguments: any;
    if (queueOptions) {
      bindQueueArguments = queueOptions.bindQueueArguments;
    }

    const routingKeys = Array.isArray(routingKey) ? routingKey : [routingKey];

    if (exchange && routingKeys) {
      await Promise.all(
        routingKeys.map((routingKey) => {
          if (routingKey != null) {
            return channel.bindQueue(
              actualQueue as string,
              exchange,
              routingKey,
              bindQueueArguments,
            );
          }
        }),
      );
    }

    return actualQueue;
  }


  /**
   * Selects managed channel based on name, if not found uses default.
   * @param name name of the channel
   * @returns channel wrapper
   */
  private selectManagedChannel(name?: string): ChannelWrapper {
    if (!name) return this._managedChannel;
    const channel = this._managedChannels[name];
    if (!channel) {
      this.logger.warn(
        `Channel "${name}" does not exist, using default channel: ${this._managedChannel.name}.`,
      );

      return this._managedChannel;
    }
    return channel;
  }

  private normalizeAlternateExchange(
    raw: string | RabbitMQAlternateExchangeConfig | undefined,
  ): RabbitMQAlternateExchangeConfig | undefined {
    if (!raw) return undefined;
    if (typeof raw === 'string') return { name: raw };
    return raw;
  }

  private async setupAlternateExchange(
    channel: ConfirmChannel,
    aeConfig: RabbitMQAlternateExchangeConfig,
  ): Promise<void> {
    await channel.assertExchange(
      aeConfig.name,
      aeConfig.type || 'fanout',
      { durable: true, ...(aeConfig.options || {}) },
    );

    if (aeConfig.unroutableQueue) {
      const { name: qName, options, bindingKey = '', bindingArgs } = aeConfig.unroutableQueue;
      await channel.assertQueue(qName, { durable: true, ...(options || {}) });
      await channel.bindQueue(qName, aeConfig.name, bindingKey, bindingArgs);
      this.logger.log(
        `Alternate exchange "${aeConfig.name}" ready (capturing unroutable messages into queue "${qName}")`,
      );
    } else {
      this.logger.log(
        `Alternate exchange "${aeConfig.name}" ready (no dedicated queue; bind one to inspect unroutable messages)`,
      );
    }
  }

  private registerConsumerForQueue<T, U>(consumer: ConsumerHandler<T, U>) {
    (this._consumers as Record<ConsumerTag, ConsumerHandler<T, U>>)[
      consumer.consumerTag
    ] = consumer;
  }

  public async cancelConsumer(consumerTag: ConsumerTag): Promise<void> {
    const consumer = this._consumers[consumerTag];
    if (!consumer) {
      return;
    }
    try {
      // basic.cancel MUST go through the raw channel that created the consumer:
      // ChannelWrapper.cancel() only knows consumers created via wrapper.consume()
      // (never used here), so it silently cancelled NOTHING and the instance kept
      // consuming — losing messages during graceful shutdown once the handler
      // registry was cleared. A stale entry from before a reconnect fails the
      // cancel on its dead channel: logged and dropped (the consumer it refers
      // to no longer exists anyway).
      await consumer.channel.cancel(consumerTag);
    } catch (err) {
      this.logger.warn?.(`Failed to cancel consumer ${consumerTag}: ${(err as Error)?.message}`);
    }
    delete this._consumers[consumerTag];
  }

  /**
   * Cancels every live consumer AND prevents their resurrection: the consume
   * setup functions re-run on every reconnect, so without the `consumersCanceled`
   * latch a reconnect after a graceful drain would silently resubscribe
   * everything. The latch is process-final, like BrokerService's `detached`.
   */
  public async cancelAllConsumers(): Promise<void> {
    this.consumersCanceled = true;
    const tags = Object.keys(this._consumers);
    await Promise.all(tags.map((tag) => this.cancelConsumer(tag)));
  }

  public async close(): Promise<void> {
    const managedChannels = Object.values(this._managedChannels);

    // First cancel all consumers so they stop getting new messages
    // (via basic.cancel on the owning channels — see cancelConsumer).
    await this.cancelAllConsumers();

    // Wait for all the outstanding messages to be processed
    if (this.outstandingMessageProcessing.size) {
      this.logger.log(
        `Waiting for outstanding consumers, outstanding message count: ${this.outstandingMessageProcessing.size}`,
      );
    }
    await Promise.all(this.outstandingMessageProcessing);

    // Close all channels
    await Promise.all(managedChannels.map((channel) => channel.close()));

    await this.managedConnection.close();
  }
}
