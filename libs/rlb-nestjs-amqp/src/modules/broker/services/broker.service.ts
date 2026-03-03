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
  private readonly rpcsPool: Map<string, { exchange?: string; queue?: string; routingKey?: string; subscribed: boolean; }> = new Map();
  private readonly handlersPool: Map<string, { exchange?: string, routingKey?: string, queue?: string, subscribed?: boolean; }> = new Map();
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

    for (const topic of this.topicConfigurations || []) {
      if (topic.mode === 'rpc') {
        let queueName: string | undefined;
        if (!topic.queue && !topic.exchange) {
          this.logger.warn(`RPC Topic ${topic.name} not added to pool. Queue or exchange are required`);
          continue;
        }
        if (topic.queue) {
          const queue = this.brokerConfig.queues.find(q => q.name === topic.queue);
          if (!queue) {
            this.logger.warn(`RPC Topic ${topic.name} not added to pool.Queue ${topic.queue} not found in broker configuration`);
            continue;
          }
          queueName = topic.name;
        }
        if (this.rpcsPool.has(topic.name)) {
          this.logger.warn(`RPC Topic ${topic.name} already registered`);
          continue;
        }
        const par: { queue?: string, subscribed: boolean; exchange?: string; routingKey?: string; } = { subscribed: false };
        if (queueName) par.queue = queueName;
        if (topic.exchange) par.exchange = topic.exchange;
        if (topic.routingKey) par.routingKey = topic.routingKey;
        this.rpcsPool.set(topic.name, par);
      } else if (topic.mode === 'broadcast') {
        if (!topic.exchange || !topic.routingKey) {
          this.logger.warn(`Broadcast Topic ${topic.name} not added to pool. Exchange and routing key are required`);
          continue;
        }
        const exchange = this.brokerConfig.exchanges.find(e => e.name === topic.exchange);
        const cname = this.brokerConfig.connectionManagerOptions.connectionOptions?.clientProperties?.connection_name;
        if (!cname) {
          throw new Error(`Client name is required for topic exchange`);
        }
        if (!exchange) {
          this.logger.warn(`Queue ${exchange} not found in broker configuration for topic ${topic.name}`);
        }
        this.handlersPool.set(topic.name, { exchange: topic.exchange, queue: `${cname}-${topic.name}`, routingKey: topic.routingKey, subscribed: false });
      } else if (topic.mode === 'handle') {
        const queue = this.brokerConfig.queues.find(q => q.name === topic.queue);
        const exchange = this.brokerConfig.exchanges.find(e => e.name === queue.exchange);
        if (!queue) {
          this.logger.warn(`Event Topic ${topic.name} not added to pool. Queue ${topic.queue} not found in broker configuration`);
        }
        if (exchange.type === 'topic') {
          if (!queue.routingKey) {
            throw new Error(`Queue ${queue.name} has no routing key`);
          }
        }
        if (this.handlersPool.has(topic.name)) {
          this.logger.warn(`Handler ${queue.name} already subscribed`);
          continue;
        }
        this.handlersPool.set(topic.name, { queue: queue.name, routingKey: topic.routingKey, subscribed: false });
      } else if (topic.mode === 'event') {
      }
      else {
        this.logger.warn(`Topic ${topic.name} has invalid mode ${topic.mode}. Valid modes are 'rpc', 'event', and 'broadcast'`);
      }
    }
  }

  publishMessage(topic: string, action: string, payload: any, headers?: any) {
    const msTopic = (this.topicConfigurations || []).find(t => t.name === topic);
    let exchange: string = '';
    let routingKey: string = '';
    if (!msTopic) {
      throw new Error(`Topic ${topic} not found in configuration`);
    }
    if (msTopic.mode !== 'event' && msTopic.mode !== 'broadcast') {
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
      this.amqpConnection.publish(exchange, routingKey, { action, payload }, { headers });
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
                this.logger.warn(`An error occurred while processing message for topic ${topic.name}. Requeued!`);
                this.logger.error(result.error);
                return new Nack(true);
              }
            }
          }, {
          queue: qName,
          exchange: eName,
          routingKey: rKey
        }, topic.name);
        this.handlersPool.set(_topic, { queue: _q.queue, subscribed: true });
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
      const queue = this.brokerConfig.queues.find(q => q.name === _q.queue);
      await this.amqpConnection.createRpc<ActionPayload<Request>, MangedFunctionExecutor<Response>>(async (msg: ActionPayload<Request>, rawMessage?: ConsumeMessage, headers?: any) => {
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
          return new Nack(true);
        }
      }, {
        queue: queue.name,
        exchange: queue.exchange,
        routingKey: queue.routingKey,
      });
      this.rpcsPool.set(_topic, { queue: _q.queue, subscribed: true });
      this.logger.log(`Subscribed to ${topic.name}. Exchange: '${queue.exchange}' Queue: '${queue.name}'`);
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
    const correlationId = randomUUID();
    const msTopic = this.topicConfigurations.find(t => t.name === topic);
    if (!msTopic) {
      throw new Error(`Topic ${topic} not found in configuration`);
    }
    let exchange: string = msTopic.exchange;
    let routingKey = msTopic.routingKey;
    if (msTopic.queue) {
      const queue = this.brokerConfig.queues.find(q => q.name === msTopic?.queue);
      if (!queue) {
        throw new Error(`Queue ${msTopic.queue} not found in configuration`);
      }
      exchange = queue.exchange;
      routingKey = routingKey || (Array.isArray(queue.routingKey) ? queue.routingKey[0] : queue.routingKey);
    }
    headers = headers || {};
    headers['X-Request-ID'] = randomUUID();
    if (!exchange || !routingKey) {
      throw new Error(`Invalid topic configuration for topic ${topic}. Exchange and routing key are required`);
    }
    const replyTo = this.brokerConfig.replyQueues?.[exchange];

    try {
      const result = await this.amqpConnection.request<MangedFunctionExecutor<Response>>({
        exchange: exchange,
        routingKey,
        payload: { action, payload },
        correlationId,
        replyTo,
        headers,
        timeout: timeout || this.brokerConfig.defaultRpcTimeout || 10000,
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

  getHandler<Request = any, Response = any>(topic: string): RpcEventHandler<Request, Response> {
    return this.handlerRegistryService.getHandlers('fun', topic);
  };

  getRpc<Request = any, Response = any>(topic: string): RpcEventHandler<Request, Response> {
    return this.handlerRegistryService.getHandlers('rpc', topic);
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
