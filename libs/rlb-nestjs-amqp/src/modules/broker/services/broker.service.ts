import { AmqpConnection, Nack } from "@golevelup/nestjs-rabbitmq";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConsumeMessage } from "amqplib";
import { isObservable, lastValueFrom, Observable, Subject } from "rxjs";
import { BrokerEvent, BrokerEventHandler, RpcEventHandler } from "../data/events/messages";
import { ConfigService } from "@nestjs/config";
import { BrokerConfig } from "../config/broker.config";
import { MicroserviceConfig } from "../config/microservices.config";
import { randomUUID } from "crypto";
import { HandlerRegistryService } from "./handler-registry.service";

@Injectable()
export class BrokerService implements OnModuleInit {

  private readonly events: Subject<BrokerEvent>;
  private readonly brokerConfig: BrokerConfig;
  private readonly microserviceConfig: MicroserviceConfig;
  private readonly logger: Logger;

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly handlerRegistryService: HandlerRegistryService,
    private readonly config: ConfigService) {
    this.events = new Subject<BrokerEvent>();
    this.brokerConfig = this.config.get<BrokerConfig>("broker");
    this.microserviceConfig = this.config.get<MicroserviceConfig>("microservices");
    this.logger = new Logger(BrokerService.name);
  }

  public get events$() {
    return this.events.asObservable();
  }

  onModuleInit() {
    for (const topic of this.microserviceConfig?.topics || []) {
      const queue = this.brokerConfig.queues.find(q => q.name === topic.queue);
      if (!queue) {
        this.logger.warn(`Queue ${topic.queue} not found in broker configuration`);
      }
      try {
        if (!topic.rpc) {
          this.amqpConnection.createSubscriber<any>(async (msg: any, rawMessage?: ConsumeMessage, headers?: any) => {
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
              if (!result) {
                this.logger.warn(`An error occurred while processing message for topic ${topic.name}. Requeued!`);
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
              this.logger.log(`Subscribed to queue ${queue.name}`);
            })
        }
        if (topic.rpc) {
          this.amqpConnection.createRpc<any, any>(async (msg: any, rawMessage?: ConsumeMessage, headers?: any) => {
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
        }
      } catch (err) {
        this.logger.error(`Error creating subscriber for queue ${queue.name}: ${err.message}`);
        throw err;
      }
    }
  }

  publishMessage(topic: string, message: any) {
    const msTopic = this.microserviceConfig.topics.find(t => t.name === topic);
    const queue = this.brokerConfig.queues.find(q => q.name === msTopic?.queue);
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
      return await this.amqpConnection.request<Response>({
        exchange: queue.exchange,
        routingKey,
        payload: { action, payload },
        correlationId,
        headers
      });
    } catch (err) {
      this.logger.error(`Error publishing message to topic ${topic}: ${err.message}`);
    }
  }

  private async executeFunction<Func, Ret>(fn: Func, ...params: any[]): Promise<Ret> {
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
    return ret;
  }

  registerHandler<Request = any, Response = any>(topic: string, handler: BrokerEventHandler<Request, Response>) {
    this.handlerRegistryService.registerHandler<Request, Response>('fun', topic, handler);
  }

  registerRpc<Request = any, Response = any>(topic: string, handler: RpcEventHandler<Request, Response>) {
    this.handlerRegistryService.registerHandler<Request, Response>('rpc', topic, handler);
  }

  getHandler<Request = any, Response = any>(topic: string): BrokerEventHandler<Request, Response> {
    return this.handlerRegistryService.getHandlers('fun', topic);
  }

  getRpc<Request = any, Response = any>(topic: string): RpcEventHandler<Request, Response> {
    return this.handlerRegistryService.getHandlers('rpc', topic);
  }
}