import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage } from "amqplib";
import { GatewayConfig, PathDefinition } from "@rlb/nestjs-core";

import { HttpHandlerService } from "../proxy/services/http-handler.service";

const CONFIG_EXCHANGE = "config.ms";
const CONFIG_QUEUE = "config.ms";
const CONFIG_TOPIC_MS = "config.ms";
const CONFIG_TOPIC_MS_PATTERN = `${CONFIG_TOPIC_MS}.#`;
const CONFIG_GATEWAY_TP = "config.gw";

@Injectable()
export class RemoteConfigService implements OnModuleInit {

  private readonly logger = new Logger(RemoteConfigService.name);
  private readonly gatewayConfig: GatewayConfig;

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly httpHandlerService: HttpHandlerService,
    private readonly configService: ConfigService
  ) {
    this.gatewayConfig = this.configService.get<GatewayConfig>("gateway");
  }

  async onModuleInit() {
    if (this.gatewayConfig.mode === 'gateway') {
      this.initGateway();
    }
    if (this.gatewayConfig.mode === 'service') {
      this.initService(this.gatewayConfig.name);
    }
  }

  private async initConfigBroker() {
    await this.amqpConnection.channel.assertExchange(CONFIG_EXCHANGE, "fanout", { durable: true });
    await this.amqpConnection.channel.assertQueue(CONFIG_QUEUE, { durable: true, });
    await this.amqpConnection.channel.bindQueue(CONFIG_QUEUE, CONFIG_EXCHANGE, '#');
  }

  private async initGateway() {
    await this.initConfigBroker();
    await this.amqpConnection.publish(CONFIG_EXCHANGE, CONFIG_GATEWAY_TP, {});
    this.amqpConnection.createSubscriber<PathDefinition>(async (msg: PathDefinition, rawMessage?: ConsumeMessage, headers?: any) => {
      try {
        if (rawMessage.fields.routingKey.startsWith(CONFIG_TOPIC_MS_PATTERN)) {
          this.logger.debug(`Try to set configuration for service '${msg.name}', path '${msg.path}'`);
          this.httpHandlerService.registerPath(msg);
        }
      }
      catch (err) {
        this.logger.error(`Error setting configuration for service '${msg.name}', path '${msg.path}': ${err.message}`);
        return new Nack(true);
      }
    }, { exchange: CONFIG_EXCHANGE, queue: CONFIG_QUEUE, routingKey: CONFIG_TOPIC_MS_PATTERN }, '')
      .catch(err => {
        this.logger.error(`Error subscribing to queue 'config': ${err.message}`);
      })
      .then((o) => {
        console.log(o);
        this.logger.log(`Subscribed to queue 'config'`);
      })
  }

  private async initService(name: string) {
    this.initConfigBroker();
    await this.amqpConnection.publish(CONFIG_EXCHANGE, `${CONFIG_TOPIC_MS}.${name}`, this.gatewayConfig);
    this.amqpConnection.createSubscriber<PathDefinition>(async (msg: PathDefinition, rawMessage?: ConsumeMessage, headers?: any) => {
      try {
        if (rawMessage.fields.routingKey === CONFIG_GATEWAY_TP) {
          this.amqpConnection.publish(CONFIG_EXCHANGE, `${CONFIG_TOPIC_MS}.${name}`, this.gatewayConfig);
          this.logger.debug(`Send configurarion of service '${msg.name}' to gateway`);
        }
      }
      catch (err) {
        this.logger.error(`Error sending configurarion of service '${msg.name}', path '${msg.path}': ${err.message}`);
        return new Nack(true);
      }
    }, { exchange: CONFIG_EXCHANGE, queue: CONFIG_QUEUE, routingKey: CONFIG_GATEWAY_TP }, '')
      .catch(err => {
        this.logger.error(`Error subscribing to queue 'config': ${err.message}`);
      })
      .then((o) => {
        console.log(o);
        this.logger.log(`Subscribed to queue 'config'`);
      })
  }
}