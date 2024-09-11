import { AmqpConnection, Nack } from "@golevelup/nestjs-rabbitmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { AppConfig } from "@rlb/nestjs-core";
import { ConfigService } from "@nestjs/config";
import { ConsumeMessage } from "amqplib";
import { isObservable, lastValueFrom, Observable, Subject } from "rxjs";
import { BrokerEvent, BrokerEventHandler, MangedFunctionExecutor, RpcEventHandler } from "../data/events/messages";
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
  private readonly handlersPool: Map<string, { queue: string, subscribed: boolean }> = new Map();
  private readonly rpcsPool: Map<string, { queue: string, subscribed: boolean }> = new Map();
  private readonly logger: Logger;

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly handlerRegistryService: HandlerRegistryService,
    private readonly config: ConfigService) {
    this.events = new Subject<BrokerEvent>();
    this.brokerConfig = this.config.get<BrokerConfig>("broker");
    this.microserviceConfig = this.config.get<MicroserviceConfig>("microservices");
    this.appConfig = this.config.get<AppConfig>("app");
    this.logger = new Logger(BrokerService.name);
  }

  public get events$() {
    return this.events.asObservable();
  }

  onModuleInit() {
    this.logger.debug('Initializing broker service');
    for (const topic of this.microserviceConfig?.topics || []) {
      const queue = this.brokerConfig.queues.find(q => q.name === topic.queue);
      if (!queue) {
        this.logger.warn(`Queue ${topic.queue} not found in broker configuration`);
      }
      try {
        if (!topic.rpc) {
          if (this.handlersPool.has(topic.name)) {
            this.logger.warn(`Queue ${queue.name} already subscribed`);
            continue;
          }
          this.handlersPool.set(topic.name, { queue: queue.name, subscribed: false });
        }
        if (topic.rpc) {
          if (this.rpcsPool.has(topic.name)) {
            this.logger.warn(`RPC ${topic.name} already registered`);
            continue;
          }
          this.rpcsPool.set(topic.name, { queue: queue.name, subscribed: false });
        }
      } catch (err) {
        this.logger.error(`Error creating subscriber for queue ${queue.name}: ${err.message}`);
        throw err;
      }
    }
  }

  publishMessage(topic: string, message: any) {
    const msTopic = (this.microserviceConfig?.topics || []).find(t => t.name === topic);
    const queue = (this.brokerConfig?.queues || []).find(q => q.name === msTopic?.queue);
    const routingKey = Array.isArray(queue.routingKey) ? queue.routingKey[0] : queue.routingKey;
    if (!queue || !routingKey) {
      throw new Error(`Topic ${topic} not found in configuration`);
    }
    try {
      this.amqpConnection.publish(queue.exchange, routingKey, message);
    } catch (err) {
      this.logger.error(`Error publishing message to topic ${topic}: ${err.message}`);
      throw err;
    }
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
    }
  }

  async registerHandler<Request = any, Response = any>(_topic: string, handler: BrokerEventHandler<Request, Response>) {
    const _q = this.handlersPool.get(_topic);
    if (!_q) {
      this.logger.warn(`Queue for topic ${_topic} not found`);
      return;
    }
    if (!_q.subscribed) {
      const topic = this.microserviceConfig.topics.find(t => t.name === _topic);
      const queue = this.brokerConfig.queues.find(q => q.name === _q.queue);
      this.logger.debug(`Subscribing ${topic.name} to queue ${queue.exchange}::${queue.name}//${queue.routingKey}`);
      await this.amqpConnection.createSubscriber<any>(async (msg: any, rawMessage?: ConsumeMessage, headers?: any) => {
        const _msg = {
          topic: topic.name,
          payload: msg,
          source: {
            exchange: rawMessage.fields.exchange,
            routingKey: rawMessage.fields.routingKey,
            tag: rawMessage.fields.consumerTag,
          },
          headers,
          raw: rawMessage.content,
        }
        if (topic.handle) {
          const func = this.handlerRegistryService.getHandlers('fun', topic.name);
          const result = await this.executeFunction<BrokerEventHandler, boolean>(func, _msg, rawMessage, headers)
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
      }, '', {})
        .catch(err => {
          this.logger.error(`Error subscribing to queue ${queue.name}: ${err.message}`);
        })
        .then((o) => {
          this.logger.debug(o);
          this.handlersPool.set(_topic, { queue: _q.queue, subscribed: true });
          this.logger.log(`Subscribed to queue ${queue.name}`);
        });
    }
    this.handlerRegistryService.registerHandler<Request, Response>('fun', _topic, handler);
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
      await this.amqpConnection.createRpc<any, any>(async (msg: any, rawMessage?: ConsumeMessage, headers?: any) => {
        const _msg = {
          topic: topic.name,
          payload: msg,
          source: {
            exchange: rawMessage.fields.exchange,
            routingKey: rawMessage.fields.routingKey,
            tag: rawMessage.fields.consumerTag,
          },
          headers,
          raw: rawMessage.content,
        }
        const func = this.handlerRegistryService.getHandlers('rpc', topic.name);
        try {
          const result = await this.executeFunction<RpcEventHandler, any>(func, _msg, rawMessage, headers)
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
      })
      this.rpcsPool.set(_topic, { queue: _q.queue, subscribed: true });
    }
    this.handlerRegistryService.registerHandler<Request, Response>('rpc', _topic, handler);
  }

  getHandler<Request = any, Response = any>(topic: string): BrokerEventHandler<Request, Response> {
    return this.handlerRegistryService.getHandlers('fun', topic);
  }

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
          ret = new Promise((r) => { r(_ret as Ret) })
        }
      } else {
        ret = new Promise(r => r(undefined));
      }
      const _ret = await ret;
      return { success: true, payload: _ret };
    } catch (error) {
      if (!devEnv) {
        delete error.stack;
      }
      return { success: false, error };
    }
  }
}