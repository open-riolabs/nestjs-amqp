import { Inject, Injectable, Logger, OnModuleInit, PipeTransform, Scope } from '@nestjs/common';
import { ModuleRef, ModulesContainer } from '@nestjs/core';
import { ConsumeMessage } from 'amqplib';
import 'reflect-metadata';
import { isObservable, lastValueFrom, Observable } from 'rxjs';
import { AmqpConnection, Nack } from '../../../amqp-lib';
import { BrokerConfig } from '../config/broker.config';
import { BrokerTopic } from '../config/topics.config';
import { RLB_AMQP_APP_OPTIONS, RLB_AMQP_BROKER_OPTIONS, RLB_AMQP_TOPIC_CONNECTION, RLB_BROKER_AUTH_METADATA_KEY, RLB_BROKER_HTTP_METADATA_KEY, RLB_BROKER_METHOD_METADATA_KEY, RLB_BROKER_PARAM_METADATA_KEY } from '../const';
import { ActionPayload, MangedFunctionExecutor } from '../data/events/messages';
import { BrokerHttpMethod, BrokerParamSource } from '../decorators';
import { AppConfig, UtilsService } from './utils.service';

@Injectable()
export class MetadataScannerService implements OnModuleInit {

  private readonly logger = new Logger(MetadataScannerService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly modulesContainer: ModulesContainer,
    @Inject(RLB_AMQP_TOPIC_CONNECTION) private readonly topicConfigurations: BrokerTopic[],
    @Inject(RLB_AMQP_BROKER_OPTIONS) private readonly brokerConfig: BrokerConfig,
    @Inject(RLB_AMQP_APP_OPTIONS) private readonly appConfig: AppConfig,
    private readonly amqpConnection: AmqpConnection,
    private readonly utils: UtilsService,
  ) { }

  private readonly metadata: {
    [key: string]: {
      [key: string]: {
        service?: any;
        method?: Function;
        type?: string;
        auth?: { allowAnonymous?: boolean, authName?: string, methodName?: string, roles?: string[]; }[];
        http?: { method: BrokerHttpMethod; path: string; dataSource?: BrokerParamSource; parseRaw?: boolean; timeout?: number; }[];
        params?: { [key: string]: { source: BrokerParamSource, name?: string; pipe?: PipeTransform; }; };
      };
    };
  } = {};

  async onModuleInit() {
    for (const [_, module] of this.modulesContainer.entries()) {
      for (const [providerKey, provider] of module.providers) {
        try {
          let instance: any;
          if (!provider || !provider.metatype) {
            continue;
          }
          const isScoped = provider.scope === Scope.REQUEST || provider.scope === Scope.TRANSIENT;
          if (isScoped) {
            instance = await this.moduleRef.resolve(providerKey);
          } else {
            instance = this.moduleRef.get(providerKey, { strict: false });
          }
          if (instance) {
            const metadata = Reflect.getMetadata(RLB_BROKER_METHOD_METADATA_KEY, instance.constructor) || [];
            if (metadata.length) {
              for (const method of metadata) {
                const topic = this.metadata[method.topic];
                if (!topic) {
                  this.metadata[method.topic] = {};
                }
                const action = this.metadata[method.topic][method.action];
                if (!action) {
                  this.metadata[method.topic][method.action] = {};
                }
                const paramMetadata = Reflect.getMetadata(RLB_BROKER_PARAM_METADATA_KEY, instance, method.methodName) || [];

                const authMetadata = (Reflect.getMetadata(RLB_BROKER_AUTH_METADATA_KEY, instance.constructor) || [])
                  .filter((m: any) => m.methodName === method.methodName);
                const httpMetadata = (Reflect.getMetadata(RLB_BROKER_HTTP_METADATA_KEY, instance.constructor) || [])
                  .filter((m: any) => m.methodName === method.methodName);


                this.metadata[method.topic][method.action] = {
                  service: instance,
                  method: instance[method.methodName],
                  type: method.type,
                  auth: [...authMetadata],
                  http: [...httpMetadata],
                  params: this.removeDefaultsFromParams(method.params as string[] || []).reduce((acc, param, index) => {
                    const meta = Object.assign({}, paramMetadata.find((p: any) => p.index === index) || { source: 'body' });
                    delete meta.index;
                    acc[param] = meta;
                    return acc;
                  }, {})
                };
              }
            }
          }
        } catch (error) { }
      }
    }
    for (const [topic, actions] of Object.entries(this.metadata)) {
      if (!topic) {
        this.logger.error(`Topic not defined for action ${Object.keys(actions).join(', ')}`);
        continue;
      }
      const cfgTopic = this.topicConfigurations.find(t => t.name === topic);
      if (!cfgTopic) {
        this.logger.error(`Topic ${topic} not found in configuration`);
        continue;
      }
      const queue = this.brokerConfig.queues.find(q => q.name === cfgTopic.queue);
      const exchange = this.brokerConfig.exchanges.find(e => e.name === (queue?.exchange || cfgTopic.exchange));
      const eName = exchange?.name || cfgTopic.exchange;
      const qName = queue?.name || cfgTopic.queue;
      const kName = cfgTopic.routingKey || (Array.isArray(queue?.routingKey) ? queue.routingKey?.[0] : queue?.routingKey);
      if (exchange?.type === 'topic') {
        if (!queue?.routingKey) throw new Error(`Queue ${queue?.name} has no routing key`);
      }
      for (const [action, { method, service }] of Object.entries(actions)) {
        this.logger.log(`Binded function \`${service.constructor.name}.${method.name}\` to action \`${action}\`. Queue \`${qName}/${topic}\``);
      }
      try {
        await this.amqpConnection.createRpc<ActionPayload<Request>, MangedFunctionExecutor<Response>>(
          async (msg: ActionPayload<Request>, rawMessage?: ConsumeMessage, headers?: any) => {
            const payload = msg.payload || {};
            const method = actions[msg.action];
            const args = [];
            if (!method) {
              this.logger.error(`Action ${msg.action} not managed by any service`);
              return new Nack(false);
            }
            for (const [param, meta] of Object.entries(method.params)) {
              let transform: (o: any, name: string) => Promise<any> = (o, name) => Promise.resolve(o);
              if (meta.pipe) {
                transform = async (o: any, name: string) => {
                  const result = meta.pipe.transform(o, { type: 'custom', data: name });
                  return result instanceof Promise ? await result : result;
                };
              }
              if (meta.source === 'header') {
                args.push(await transform(headers[meta.name || param], meta.name || param));
                continue;
              }
              if (meta.source === 'body-full') {
                args.push(await transform(payload, ''));
                continue;
              }
              if (meta.source === 'body') {
                args.push(await transform(payload[meta.name || param], meta.name || param));
                continue;
              }
              if (meta.source === 'tag') {
                args.push(await transform(rawMessage.fields.consumerTag, 'tag'));
                continue;
              }
              if (meta.source === 'action') {
                args.push(await transform(msg.action, 'action'));
                continue;
              }
              if (meta.source === 'topic') {
                args.push(await transform(topic, 'topic'));
                continue;
              }
            }
            try {
              const result = await this.executeFunction<Response>(method.service, method.method, args);
              return result;
            }
            catch (err) {
              this.logger.error(`An error occurred while processing message for topic ${cfgTopic.name}: ${err.message}`);
              return new Nack(false);
            }
          }, {

          queue: qName,
          exchange: eName,
          routingKey: kName,
        });
      } catch (error) {
        this.logger.error(`Error subscribing [${topic}] to ${eName}:${qName}:${kName}`);
      }
    }
  }

  private async executeFunction<Ret>(context: any, fn: Function, params: any[]): Promise<MangedFunctionExecutor<Ret>> {
    try {
      let ret: Promise<Ret>;
      if (typeof fn === 'function') {
        const _ret: Ret | Observable<Ret> | Promise<Ret> = await fn.apply(context, params);
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

  private removeDefaultsFromParams(params: string[]): string[] {
    const cleaned: string[] = [];
    for (let i = 0; i < params.length; i++) {
      if (params[i] === '=') {
        i++; // salta il valore dopo =
      } else {
        cleaned.push(params[i]);
      }
    }
    return cleaned;
  }

  get metaInfo() {
    if (!this.metadata) {
      return {};
    }
    const r = {};
    for (const p of Object.keys(this.metadata)) {
      for (const j of Object.keys(this.metadata[p])) {
        if (!r[p]) r[p] = {};
        r[p][j] = {
          type: this.metadata[p][j].type,
          auth: structuredClone(this.metadata[p][j].auth),
          http: structuredClone(this.metadata[p][j].http),
          params: structuredClone(this.metadata[p][j].params),
        };
      }
    }
    return r;
  }

}