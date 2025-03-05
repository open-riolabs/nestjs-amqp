import { AmqpConnection, Nack } from "@golevelup/nestjs-rabbitmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { AppConfig, UtilsService } from "@sicilyaction/lib-nestjs-core";
import { ConfigService } from "@nestjs/config";
import { ConsumeMessage } from "amqplib";
import { isObservable, lastValueFrom, map, Observable, Subject } from "rxjs";
import { BrokerEvent, BrokerEventHandler, MangedFunctionExecutor, RpcEvent, RpcEventHandler, TopicEventHandler } from "../data/events/messages";
import { randomUUID } from "crypto";
import { BrokerConfig } from "../config/broker.config";
import { MicroserviceConfig } from "../config/microservices.config";
import { HandlerRegistryService } from "./handler-registry.service";

@Injectable()
export class BrokerService implements OnModuleInit {

  private readonly events: Subject<BrokerEvent>;
  private readonly brokerConfig: BrokerConfig;
  private readonly microserviceConfig: MicroserviceConfig;
  private readonly appConfig: AppConfig;
  private readonly handlersPool: Map<string, { queue: string, subscribed: boolean; }> = new Map();
  private readonly rpcsPool: Map<string, { queue: string, subscribed: boolean; }> = new Map();
  private readonly topicPool: Map<string, { exchange: string, routingKey: string, subscribed: boolean; }> = new Map();
  private readonly logger: Logger;

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly handlerRegistryService: HandlerRegistryService,
    private readonly config: ConfigService,
    private readonly utils: UtilsService) {
    this.events = new Subject<BrokerEvent>();
    this.brokerConfig = this.config.get<BrokerConfig>("broker");
    this.microserviceConfig = this.config.get<MicroserviceConfig>("microservices");
    this.appConfig = this.config.get<AppConfig>("app");
    this.logger = new Logger(BrokerService.name);
  }

  public get events$() {
    return this.events.asObservable();
  }

  public getEvents$<T>() {
    return this.events$.pipe(map(e => e as BrokerEvent<T>));
  }

  onModuleInit() {
    this.logger.debug('Initializing broker service');

    for (const topic of this.microserviceConfig?.topics || []) {
      if (topic.rpc) {
        const queue = this.brokerConfig.queues.find(q => q.name === topic.queue);
        if (!queue) {
          this.logger.warn(`Queue ${topic.queue} not found in broker configuration`);
        }
        if (this.rpcsPool.has(topic.name)) {
          this.logger.warn(`RPC ${topic.name} already registered`);
          continue;
        }
        this.rpcsPool.set(topic.name, { queue: queue.name, subscribed: false });
      } else if (topic.exchange && topic.routingKey) {
        const cname = this.brokerConfig.connectionManagerOptions.connectionOptions?.clientProperties?.connection_name;
        const exchange = this.brokerConfig.exchanges.find(e => e.name === topic.exchange);
        if (!cname) {
          throw new Error(`Client name is required for topic exchange`);
        }
        if (!exchange) {
          this.logger.warn(`Queue ${exchange} not found in broker configuration for topic ${topic.name}`);
        }
        this.topicPool.set(topic.name, { exchange: topic.exchange, routingKey: topic.routingKey, subscribed: false });
      } else {
        const queue = this.brokerConfig.queues.find(q => q.name === topic.queue);
        const exchange = this.brokerConfig.exchanges.find(e => e.name === queue.exchange);
        if (!queue) {
          this.logger.warn(`Queue ${topic.queue} not found in broker configuration`);
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
        this.handlersPool.set(topic.name, { queue: queue.name, subscribed: false });
      }
    }
  }

  publishMessage(topic: string, action: string, payload: any, headers?: any) {
    const msTopic = (this.microserviceConfig?.topics || []).find(t => t.name === topic);
    let exchange: string = '';
    let routingKey: string = '';
    if (!msTopic.routingKey) {
      const queue = (this.brokerConfig?.queues || []).find(q => q.name === msTopic?.queue);
      routingKey = Array.isArray(queue.routingKey) ? queue.routingKey[0] : queue.routingKey;
      if (!queue || !routingKey) {
        throw new Error(`Topic ${topic} not found in configuration`);
      }
      exchange = queue.exchange;
    } else {
      routingKey = msTopic.routingKey;
      exchange = (this.brokerConfig?.exchanges || []).find(e => e.name === msTopic?.exchange)?.name;
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

  async registerHandler<Request = any>(_topic: string, handler?: BrokerEventHandler<Request, Response>) {
    const _q = this.handlersPool.get(_topic);
    if (!_q) {
      this.logger.warn(`Queue for topic ${_topic} not found`);
      return;
    }
    if (!_q.subscribed) {
      const topic = this.microserviceConfig.topics.find(t => t.name === _topic);
      const queue = this.brokerConfig.queues.find(q => q.name === _q.queue);
      const exchange = this.brokerConfig.exchanges.find(e => e.name === queue.exchange);
      if (!topic) throw new Error(`Topic ${_topic} not found in configuration`);
      if (!queue) throw new Error(`Queue ${_q.queue} not found in configuration for topic ${_topic}`);
      if (!exchange) throw new Error(`Exchange ${queue.exchange} not found in configuration for queue ${queue.name}`);
      if (exchange.type === 'topic') {
        if (!queue.routingKey) throw new Error(`Queue ${queue.name} has no routing key`);
      }
      this.logger.debug(`Subscribing ${topic.name} to queue ${queue.exchange}::${queue.name}//${queue.routingKey}`);
      try {
        const o = await this.amqpConnection.createSubscriber<RpcEvent>(async (msg: RpcEvent, rawMessage?: ConsumeMessage, headers?: any) => {
          const _msg: BrokerEvent = {
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
          if (topic.handle) {
            const func = this.handlerRegistryService.getHandlers('fun', topic.name);
            const result = await this.executeFunction<BrokerEventHandler, boolean>(func, _msg, rawMessage, headers);
            if (!result.success) {
              this.logger.warn(`An error occurred while processing message for topic ${topic.name}. Requeued!`);
              this.logger.error(result.error);
              return new Nack(true);
            }
          }
          else {
            this.events.next(_msg);
          }
        }, {
          queue: queue.name,
          exchange: queue.exchange,
          routingKey: queue.routingKey,
        }, '', {});
        this.logger.debug(`Subscribed to queue ${queue.name} with consumer tag ${o.consumerTag}`);
        this.handlersPool.set(_topic, { queue: _q.queue, subscribed: true });
        this.logger.log(`Subscribed to queue ${queue.name}`);
      } catch (error) {
        this.logger.error(`Error subscribing to queue ${queue.name}: ${error.message}`);
      }
      if (topic.handle) {
        if (!handler) throw new Error(`Topic ${_topic} requires a handler function becouse it has handle property set to true`);
        this.handlerRegistryService.registerHandler<Request, Response>('fun', _topic, handler);
      }
    }
  }

  async registerTopic<Request = any>(_topic: string, handler?: TopicEventHandler<Request>) {
    const _q = this.topicPool.get(_topic);
    if (!_q) {
      this.logger.warn(`Queue for topic ${_topic} not found`);
      return;
    }
    if (!_q.subscribed) {
      const topic = this.microserviceConfig.topics.find(t => t.name === _topic);
      const exchange = this.brokerConfig.exchanges.find(e => e.name === topic.exchange);
      const cname = this.brokerConfig.connectionManagerOptions.connectionOptions?.clientProperties?.connection_name;
      if (!topic) throw new Error(`Topic ${_topic} not found in configuration`);
      if (!exchange) throw new Error(`Exchange ${topic.exchange} not found in configuration for topic ${topic.name}`);
      if (exchange.type !== 'topic') {
        throw new Error(`Invalid exchange type. Type for ${exchange.name} must by topic`);
      }
      if (!cname) {
        throw new Error('Client name is required for topic exchange');
      }
      this.logger.debug(`Subscribing ${topic.name} to exchange ${exchange.name}::${topic.name}-${cname}//${topic.routingKey}`);
      try {
        const o = await this.amqpConnection.createSubscriber<RpcEvent>(async (msg: RpcEvent, rawMessage?: ConsumeMessage, headers?: any) => {
          const _msg: BrokerEvent = {
            topic: topic.name,
            payload: msg,
            source: {
              exchange: rawMessage.fields.exchange,
              routingKey: rawMessage.fields.routingKey,
              tag: rawMessage.fields.consumerTag,
            },
            action: msg.action,
            headers,
            raw: rawMessage.content,
          };
          if (topic.handle) {
            const func = this.handlerRegistryService.getHandlers('fun', topic.name);
            const result = await this.executeFunction<BrokerEventHandler, boolean>(func, _msg, rawMessage, headers);
            if (!result.success) {
              this.logger.warn(`An error occurred while processing message for topic ${topic.name}. Requeued!`);
              this.logger.error(result.error);
              return new Nack(true);
            }
          }
          else {
            this.events.next(_msg);
          }
        }, {
          queue: `${topic.name}-${cname}`,
          exchange: topic.exchange,
          routingKey: topic.routingKey,
          createQueueIfNotExists: true,
          queueOptions: {
            durable: true,
            autoDelete: false,
          }
        }, '', {});
        this.logger.debug(`Subscribed to ${topic.name} using ${exchange.name}::${topic.name}-${cname}//${topic.routingKey}`);
        this.topicPool.set(_topic, { exchange: topic.exchange, routingKey: topic.routingKey, subscribed: true });
        this.logger.log(`Subscribed to topic ${topic.name}`);
      } catch (error) {
        this.logger.error(`Error subscribing to topic ${topic.name}: ${error.message}`);
      }
      if (topic.handle) {
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
      const topic = this.microserviceConfig.topics.find(t => t.name === _topic);
      const queue = this.brokerConfig.queues.find(q => q.name === _q.queue);
      this.logger.debug(`Subscribing ${topic.name} to queue ${queue.exchange}::${queue.name}//${queue.routingKey}`);
      await this.amqpConnection.createRpc<RpcEvent, MangedFunctionExecutor<Response>>(async (msg: RpcEvent, rawMessage?: ConsumeMessage, headers?: any) => {
        const _msg: BrokerEvent<RpcEvent> = {
          topic: topic.name,
          payload: msg,
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
    }
    this.handlerRegistryService.registerHandler<Request, Response>('rpc', _topic, handler);
  }

  async requestData<Request = any, Response = any>(topic: string, action: string, payload: Request, headers?: any): Promise<Response> {
    const correlationId = randomUUID();
    const msTopic = this.microserviceConfig.topics.find(t => t.name === topic);
    const queue = this.brokerConfig.queues.find(q => q.name === msTopic?.queue);
    const routingKey = Array.isArray(queue.routingKey) ? queue.routingKey[0] : queue.routingKey;
    headers = headers || {};
    headers['X-Request-ID'] = randomUUID();
    if (!queue || !routingKey) {
      throw new Error(`Topic ${topic} not found in configuration`);
    }
    try {
      const result = await this.amqpConnection.request<MangedFunctionExecutor<Response>>({
        exchange: queue.exchange,
        routingKey,
        payload: { action, payload },
        correlationId,
        headers
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

  getHandler<Request = any, Response = any>(topic: string): BrokerEventHandler<Request, Response> {
    return this.handlerRegistryService.getHandlers('fun', topic);
  };

  getRpc<Request = any, Response = any>(topic: string): RpcEventHandler<Request, Response> {
    return this.handlerRegistryService.getHandlers('rpc', topic);
  }

  private async executeFunction<Func, Ret>(fn: Func, ...params: any[]): Promise<MangedFunctionExecutor<Ret>> {
    const devEnv = this.appConfig.environment !== 'production';
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
