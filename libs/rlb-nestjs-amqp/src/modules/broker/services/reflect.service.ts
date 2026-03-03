import { Inject, Injectable, Logger, OnModuleInit, Scope } from '@nestjs/common';
import { ModuleRef, ModulesContainer } from '@nestjs/core';
import { ConsumeMessage } from 'amqplib';
import 'reflect-metadata';
import { isObservable, lastValueFrom, Observable } from 'rxjs';
import { inspect } from 'util';
import { AmqpConnection, Nack } from '../../../amqp-lib';
import { BrokerConfig } from '../config/broker.config';
import { BrokerTopic } from '../config/topics.config';
import { RLB_AMQP_APP_OPTIONS, RLB_AMQP_BROKER_OPTIONS, RLB_AMQP_TOPIC_CONNECTION, RLB_BROKER_METHOD_METADATA_KEY, RLB_BROKER_PARAM_METADATA_KEY } from '../const';
import { ActionPayload, MangedFunctionExecutor } from '../data/events/messages';
import { BrokerParamSource } from '../decorators';
import { AppConfig, UtilsService } from './utils.service';

@Injectable()
export class MetadataScannerService implements OnModuleInit {

  private readonly logger = new Logger(MetadataScannerService.name);


  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly modulesContainer: ModulesContainer,
    private readonly amqpConnection: AmqpConnection,
    private readonly utils: UtilsService,
    @Inject(RLB_AMQP_BROKER_OPTIONS) private readonly brokerConfig: BrokerConfig,
    @Inject(RLB_AMQP_TOPIC_CONNECTION) private readonly topicConfigurations: BrokerTopic[],
    @Inject(RLB_AMQP_APP_OPTIONS) private readonly appConfig: AppConfig,
  ) { }

  private readonly metadata: {
    [key: string]: {
      [key: string]: {
        service?: any;
        method?: Function;
        params?: { [key: string]: { source: BrokerParamSource, name?: string; }; };
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
                this.metadata[method.topic][method.action] = {
                  service: instance,
                  method: instance[method.methodName],
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
      const cfgTopic = this.topicConfigurations.find(t => t.name === topic);
      const queue = this.brokerConfig.queues.find(q => q.name === cfgTopic.queue);
      const exchange = this.brokerConfig.exchanges.find(e => e.name === queue.exchange);
      if (!topic) throw new Error(`Topic ${cfgTopic} not found in configuration`);
      if (!queue) throw new Error(`Queue ${cfgTopic.queue} not found in configuration for topic ${cfgTopic}`);
      if (!exchange) throw new Error(`Exchange ${queue.exchange} not found in configuration for queue ${queue.name}`);
      if (exchange.type === 'topic') {
        if (!queue.routingKey) throw new Error(`Queue ${queue.name} has no routing key`);
      }
      for (const [action, { method, service }] of Object.entries(actions)) {
        this.logger.log(`Binded function \`${service.constructor.name}.${method.name}\` to action \`${action}\`. Queue \`${queue.name}/${topic}\``);
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
              if (meta.source === 'header') {
                args.push(headers[meta.name || param]);
                continue;
              }
              if (meta.source === 'body-full') {
                args.push(payload);
                continue;
              }
              if (meta.source === 'body') {
                args.push(payload[meta.name || param]);
                continue;
              }
              if (meta.source === 'tag') {
                args.push(rawMessage.fields.consumerTag);
                continue;
              }
            }
            try {
              const result = await this.executeFunction<Response>(method.service, method.method, args);
              return result;
            }
            catch (err) {
              this.logger.error(`An error occurred while processing message for topic ${cfgTopic.name}: ${err.message}`);
              return new Nack(true);
            }
          }, {
          queue: queue.name,
          exchange: queue.exchange,
          routingKey: queue.routingKey,
        });
      } catch (error) {
        this.logger.error(`Error subscribing to ${topic}::${queue.name}::${queue.routingKey}`);
        this.logger.error(inspect(error));
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

  removeDefaultsFromParams(params: string[]): string[] {
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

}