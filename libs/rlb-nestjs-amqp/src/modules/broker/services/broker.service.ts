import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConsumeMessage } from "amqplib";
import { randomUUID } from "crypto";
import { isObservable, lastValueFrom, map, Observable, Subject } from "rxjs";
import { AmqpConnection, Nack } from "../../../amqp-lib";
import { BrokerConfig } from "../config/broker.config";
import { BrokerTopic } from "../config/topics.config";
import { RLB_AMQP_BROKER_OPTIONS, RLB_AMQP_TOPIC_CONNECTION } from "../const";
import { ActionPayload, BrokerEvent, MangedFunctionExecutor, RpcEventHandler } from "../data/events/messages";
import { HandlerRegistryService } from "./handler-registry.service";
import { AppConfig, UtilsService } from "./utils.service";

@Injectable()
export class BrokerService implements OnModuleInit {

  private readonly events: Subject<BrokerEvent>;
  private readonly rpcsPool: Map<string, { exchange?: string; queue?: string; routingKey?: string | string[]; subscribed: boolean; consumerTag?: string; }> = new Map();
  private readonly handlersPool: Map<string, { exchange?: string, routingKey?: string, queue?: string, subscribed?: boolean; consumerTag?: string; }> = new Map();
  private detached = false;
  private readonly logger: Logger;
  private readonly appConfig: AppConfig;
  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly handlerRegistryService: HandlerRegistryService,
    @Inject(RLB_AMQP_BROKER_OPTIONS) private readonly brokerConfig: BrokerConfig,
    @Inject(RLB_AMQP_TOPIC_CONNECTION) private readonly topicConfigurations: BrokerTopic[],
    private readonly utils: UtilsService) {
    this.events = new Subject<BrokerEvent>();
    this.logger = new Logger(BrokerService.name);
  }

  public get events$() {
    return this.events.asObservable();
  }

  public getEvents$<T>() {
    return this.events$.pipe(map(e => e as BrokerEvent<T>));
  }

  onModuleInit() {
    this.logger.log('Initializing broker service');

    // The retry dead-letter exchange is NOT auto-asserted (a wrong assert would 406 the
    // channel): it must be declared in broker.exchanges. Surface a misconfiguration at
    // boot instead of at the first dead-letter attempt.
    const dlExchanges = new Set<string>();
    if (this.brokerConfig.retry?.deadLetter?.exchange) dlExchanges.add(this.brokerConfig.retry.deadLetter.exchange);
    for (const t of this.topicConfigurations || []) {
      if (t.retry?.deadLetter?.exchange) dlExchanges.add(t.retry.deadLetter.exchange);
    }
    for (const ex of dlExchanges) {
      if (!this.brokerConfig.exchanges?.some(e => e.name === ex)) {
        this.logger.warn(`Retry dead-letter exchange '${ex}' is not declared in broker.exchanges; dead-lettering will fail at runtime (messages fall back to nack-requeue) until the exchange exists.`);
      }
    }

    for (const topic of this.topicConfigurations || []) {
      if (topic.mode === 'rpc') {
        if (!topic.queue && !topic.exchange) {
          this.logger.warn(`RPC Topic ${topic.name} not added to pool. Queue or exchange are required`);
          continue;
        }
        if (this.rpcsPool.has(topic.name)) {
          this.logger.warn(`RPC Topic ${topic.name} already registered`);
          continue;
        }
        const par: { queue?: string, subscribed: boolean; exchange?: string; routingKey?: string; } = { subscribed: false };
        if (topic.queue) par.queue = topic.queue;
        if (topic.exchange) par.exchange = topic.exchange;
        if (topic.routingKey) par.routingKey = topic.routingKey;
        this.rpcsPool.set(topic.name, par);
      } else if (topic.mode === 'broadcast') {
        if (!topic.exchange || !topic.routingKey) {
          this.logger.warn(`Broadcast Topic ${topic.name} not added to pool. Exchange and routing key are required`);
          continue;
        }
        const cname = this.brokerConfig.connectionManagerOptions?.connectionOptions?.clientProperties?.connection_name;
        if (!cname) {
          throw new Error(`Client name is required for topic exchange`);
        }
        this.handlersPool.set(topic.name, { exchange: topic.exchange, queue: `${topic.name}-${cname}`, routingKey: topic.routingKey, subscribed: false });
      } else if (topic.mode === 'handle') {
        const queue = this.brokerConfig.queues.find(q => q.name === topic.queue);
        if (!queue) {
          this.logger.warn(`Queue ${topic.queue} not found in broker configuration`);
        }
        const exchange = this.brokerConfig.exchanges.find(e => e.name === (queue?.exchange ?? topic.exchange));
        if (exchange?.type === 'topic') {
          if (!queue?.routingKey) {
            throw new Error(`Queue ${queue.name} has no routing key`);
          }
        }
        if (this.handlersPool.has(topic.name)) {
          this.logger.warn(`Handler ${queue.name} already subscribed`);
          continue;
        }
        this.handlersPool.set(topic.name, {
          queue: queue?.name || topic.queue,
          routingKey: (Array.isArray(queue?.routingKey) ? queue?.routingKey?.[0] : queue?.routingKey) || topic.routingKey,
          exchange: exchange?.name || topic.exchange,
          subscribed: false
        });
      } else if (topic.mode === 'event') {
      }
      else {
        this.logger.warn(`Topic ${topic.name} has invalid mode ${topic.mode}. Valid modes are 'rpc', 'event', 'broadcast' and 'handle'`);
      }
    }
  }

  async publishMessage(topic: string, action: string, payload: any, headers?: any): Promise<boolean> {
    if (this.detached) {
      throw new Error(`Broker is detached: cannot publish to topic '${topic}'. Outgoing traffic was disabled by unregisterAll().`);
    }
    const msTopic = (this.topicConfigurations || []).find(t => t.name === topic);
    let exchange: string = '';
    let routingKey: string = '';
    if (!msTopic) {
      throw new Error(`Topic ${topic} not found in configuration`);
    }
    // RPC/handle topics expose decorated `@BrokerAction` handlers. Allowing them
    // here lets the same handler be reached fire-and-forget (event semantics):
    // the consumer's RPC channel runs the function and skips the reply when no
    // `replyTo` is present, so producers can wait only for the broker to take
    // charge of the message (publisher confirm) instead of for a response.
    if (!['event', 'broadcast', 'rpc', 'handle'].includes(msTopic.mode)) {
      throw new Error(`Topic ${topic} is not configured for publishing`);
    }
    if (!msTopic.routingKey) {
      const queue = (this.brokerConfig?.queues || []).find(q => q.name === msTopic?.queue);
      routingKey = Array.isArray(queue?.routingKey) ? queue?.routingKey?.[0] : queue?.routingKey;
      if (!queue && !routingKey) {
        throw new Error(`No routing key found for topic ${topic}`);
      }
      exchange = queue.exchange;
    } else {
      routingKey = msTopic.routingKey;
      exchange = msTopic.exchange;
      if (!exchange) {
        throw new Error(`Exchange not found for topic ${topic}`);
      }
    }
    try {
      // Await the publish so this resolves only once the broker has accepted the
      // message (publisher confirm via ConfirmChannel). Rejects on nack/error.
      return await this.amqpConnection.publish(exchange, routingKey, { action, payload }, { headers, mandatory: msTopic.mandatory, persistent: msTopic.persistent });
    } catch (err) {
      this.logger.error(`Error publishing message to topic ${topic}: ${err.message}`);
      throw err;
    }
  }

  async registerHandler<Request = any>(_topic: string, handler?: RpcEventHandler<Request, void>) {
    const topic = this.topicConfigurations.find(t => t.name === _topic);
    const _q = this.handlersPool.get(_topic);
    if (!_q) {
      this.logger.error(`Topic ${_topic} not found in handler pool`);
      return;
    }
    if (!_q.subscribed) {
      let qName = _q.queue;
      let eName = _q.exchange;
      let rKey = _q.routingKey;
      try {
        const o = await this.amqpConnection.createSubscriber<ActionPayload<Request>>(
          async (msg: ActionPayload<Request>, rawMessage?: ConsumeMessage, headers?: any) => {
            const _msg: BrokerEvent<Request> = {
              topic: topic.name,
              payload: msg.payload,
              source: {
                exchange: rawMessage.fields.exchange,
                routingKey: rawMessage.fields.routingKey,
                tag: rawMessage.fields.consumerTag,
              },
              action: msg.action,
              headers,
              raw: rawMessage.content,
            };
            if (topic.toObservable) {
              this.events.next(_msg);
            }
            else {
              const func = this.handlerRegistryService.getHandlers('fun', topic.name);
              const result = await this.executeFunction<RpcEventHandler, boolean>(func, _msg, rawMessage, headers);
              if (!result.success) {
                this.logger.warn(`An error occurred while processing message for topic ${topic.name}.`);
                this.logger.error(result.error);
                // Throw so the connection-level error handler applies the configured retry
                // policy (bounded attempts + dead-letter/drop). Returning Nack(true) here
                // bypassed it and requeued the message forever (poison-message hot loop).
                throw result.error;
              }
            }
          }, {
          queue: qName,
          exchange: eName,
          routingKey: rKey,
          retry: topic.retry,
          // Broadcast queues are PER-INSTANCE (named `${topic}-${connection_name}`, which is
          // uniquified per instance). They must die with their consumer: a durable leftover
          // from a retired/renamed instance would stay bound to the exchange and accumulate
          // every broadcast forever (unbounded broker disk growth).
          queueOptions: topic.mode === 'broadcast' ? { durable: false, autoDelete: true } : undefined,
        }, topic.name);
        this.handlersPool.set(_topic, { queue: _q.queue, exchange: eName, routingKey: rKey, subscribed: true, consumerTag: o.consumerTag });
        this.logger.log(`Handler subscribed [${topic.name}]. Path: '${eName}/${qName}#${rKey}' Consumer Tag: ${o.consumerTag}`);
      } catch (error) {
        this.logger.error(`An error occured subscribing handler for topic: '${topic.name}' Details: ${error.message}`);
      }
      if (!topic.toObservable) {
        if (!handler) throw new Error(`Topic ${_topic} requires a handler function becouse it has handle property set to true`);
        this.handlerRegistryService.registerHandler<Request, void>('fun', _topic, handler);
      }
    }
  }

  async registerRpc<Request = any, Response = any>(_topic: string, handler: RpcEventHandler<Request, Response>) {
    const _q = this.rpcsPool.get(_topic);
    if (!_q) {
      this.logger.warn(`Queue for topic ${_topic} not found`);
      return;
    }
    if (!_q.subscribed) {
      const topic = this.topicConfigurations.find(t => t.name === _topic);
      // Resolve the AMQP path from the queue config when the topic names one, falling back
      // to the pool entry (exchange-only rpc topics have no queue: the broker assigns a
      // server-named queue bound to exchange/routingKey).
      const queue = _q.queue ? this.brokerConfig.queues.find(q => q.name === _q.queue) : undefined;
      if (_q.queue && !queue) {
        this.logger.error(`Queue ${_q.queue} for topic ${_topic} not found in broker configuration`);
        return;
      }
      const qName = queue?.name ?? _q.queue;
      const eName = queue?.exchange ?? _q.exchange;
      const rKey = queue?.routingKey ?? _q.routingKey;
      const subscription = await this.amqpConnection.createRpc<ActionPayload<Request>, MangedFunctionExecutor<Response>>(async (msg: ActionPayload<Request>, rawMessage?: ConsumeMessage, headers?: any) => {
        const _msg: BrokerEvent<Request> = {
          topic: topic.name,
          payload: msg.payload,
          source: {
            exchange: rawMessage.fields.exchange,
            routingKey: rawMessage.fields.routingKey,
            tag: rawMessage.fields.consumerTag,
          },
          headers,
          action: msg.action,
          raw: rawMessage.content,
        };
        const func = this.handlerRegistryService.getHandlers('rpc', topic.name);
        try {
          const result = await this.executeFunction<RpcEventHandler, Response>(func, _msg, rawMessage, headers);
          return result;
        }
        catch (err) {
          this.logger.error(`An error occurred while processing message for topic ${topic.name}: ${err.message}`);
          // Rethrow so the configured retry policy applies (bounded attempts, then error
          // reply to the RPC caller + dead-letter/drop) instead of requeueing forever.
          throw err;
        }
      }, {
        queue: qName,
        exchange: eName,
        routingKey: rKey,
        retry: topic?.retry,
      });
      this.rpcsPool.set(_topic, {
        queue: qName,
        exchange: eName,
        routingKey: rKey,
        subscribed: true,
        consumerTag: subscription.consumerTag,
      });
      this.logger.log(`Subscribed to ${topic.name}. Exchange: '${eName}' Queue: '${qName}' Consumer Tag: ${subscription.consumerTag}`);
    }
    this.handlerRegistryService.registerHandler<Request, Response>('rpc', _topic, handler);
  }

  async requestData<Request = any, Response = any>(
    topic: string,
    action: string,
    payload?: Request,
    headers?: any,
    timeout?: number,
  ): Promise<Response> {
    if (this.detached) {
      throw new Error(`Broker is detached: cannot request data on topic '${topic}'. Outgoing traffic was disabled by unregisterAll().`);
    }
    const correlationId = randomUUID();
    const msTopic = this.topicConfigurations.find(t => t.name === topic);
    if (!msTopic) {
      throw new Error(`Topic ${topic} not found in configuration`);
    }
    let exchange: string = msTopic.exchange;
    let routingKey = msTopic.routingKey;
    if (msTopic.queue) {
      const queue = this.brokerConfig.queues.find(q => q.name === msTopic?.queue);
      exchange = queue?.exchange || exchange;
      routingKey = routingKey || (Array.isArray(queue?.routingKey) ? queue?.routingKey[0] : queue?.routingKey);
    }
    headers = headers || {};
    headers['X-Request-ID'] = randomUUID();
    if (!exchange || !routingKey) {
      throw new Error(`Invalid topic configuration for topic ${topic}. Exchange and routing key are required`);
    }
    const replyTo = this.brokerConfig.replyQueues?.[exchange];

    const rpcTimeout = timeout || this.brokerConfig.defaultRpcTimeout || 10000;

    try {
      const result = await this.amqpConnection.request<MangedFunctionExecutor<Response>>({
        exchange: exchange,
        routingKey,
        payload: { action, payload },
        correlationId,
        replyTo,
        headers,
        timeout: rpcTimeout,
        // Message TTL = the caller's timeout: once the caller has already received an
        // RpcTimeoutError nobody is waiting for the reply, so a request still sitting in a
        // backed-up queue must NOT be executed later (ghost side effects, duplicate writes
        // when the client retries). RabbitMQ drops (or dead-letters) it instead.
        expiration: rpcTimeout,
        publishOptions: { mandatory: msTopic.mandatory, persistent: msTopic.persistent },
      });
      if (!result.success) {
        throw result.error;
      }
      return result.payload;
    } catch (err) {
      this.logger.error(`Error publishing message to topic ${topic}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Detach every registered consumer on the AMQP connection: subscribers/RPCs
   * registered explicitly via `registerHandler` / `registerRpc` and the ones
   * auto-discovered by `MetadataScannerService` from `@BrokerAction` decorators.
   *
   * After this call:
   *   - the broker stops consuming messages from RabbitMQ (remote callers hit
   *     their RPC timeout, events pile up on the queues);
   *   - `publishMessage` and `requestData` are also locked down: any further
   *     attempt throws synchronously, so this instance becomes fully silent
   *     in both directions.
   *
   * Pool state and the handler registry are reset, but the `detached` guard
   * is persistent: once tripped it stays on for the lifetime of the service.
   */
  async unregisterAll(): Promise<void> {
    this.logger.log('Unregistering all broker subscriptions and locking outgoing traffic');

    this.detached = true;

    await this.amqpConnection.cancelAllConsumers();

    for (const [topicName, entry] of this.rpcsPool) {
      this.rpcsPool.set(topicName, { ...entry, subscribed: false, consumerTag: undefined });
    }
    for (const [topicName, entry] of this.handlersPool) {
      this.handlersPool.set(topicName, { ...entry, subscribed: false, consumerTag: undefined });
    }

    this.handlerRegistryService.clear();
  }

  public get isDetached(): boolean {
    return this.detached;
  }

  getHandler<Request = any, Response = any>(topic: string): RpcEventHandler<Request, Response> {
    return this.handlerRegistryService.getHandlers('fun', topic);
  };

  getRpc<Request = any, Response = any>(topic: string): RpcEventHandler<Request, Response> {
    return this.handlerRegistryService.getHandlers('rpc', topic);
  }

  public get topics() {
    return this.topicConfigurations;
  }

  private async executeFunction<Func, Ret>(fn: Function, ...params: any[]): Promise<MangedFunctionExecutor<Ret>> {
    try {
      let ret: Promise<Ret>;
      if (typeof fn === 'function') {
        const _ret: Ret | Observable<Ret> | Promise<Ret> = fn(...params);
        if (isObservable(_ret)) {
          ret = lastValueFrom(_ret);
        } else if (_ret instanceof Promise && typeof _ret.then === 'function') {
          ret = _ret;
        } else {
          ret = new Promise((r) => { r(_ret as Ret); });
        }
      } else {
        ret = new Promise(r => r(undefined));
      }
      const _ret = await ret;
      return { success: true, payload: _ret };
    } catch (error) {
      return { success: false, error: this.utils.error2Object(error, this.appConfig.environment !== 'production') };
    }
  }
}
