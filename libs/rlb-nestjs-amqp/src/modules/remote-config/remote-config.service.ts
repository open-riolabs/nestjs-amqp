import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConsumeMessage } from "amqplib";
import { AmqpConnection, Nack } from '../../amqp-lib';
import { RLB_AMQP_GATEWAY_OPTIONS } from "../broker/const";
import { GatewayConfig, PathDefinition } from "../proxy/config/path-definition.config";
import { HttpHandlerService } from "../proxy/services/http-handler.service";

const CONFIG_EXCHANGE = "config.ms";
const CONFIG_QUEUE = "config.ms";
const CONFIG_TOPIC_MS = "config.ms";
const CONFIG_TOPIC_MS_PATTERN = `${CONFIG_TOPIC_MS}.#`;
const CONFIG_GATEWAY_TP = "config.gw";

@Injectable()
export class RemoteConfigService {

  private readonly logger = new Logger(RemoteConfigService.name);

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly httpHandlerService: HttpHandlerService,
    @Inject(RLB_AMQP_GATEWAY_OPTIONS) private readonly gatewayConfig: GatewayConfig,
  ) { }

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
        // console.log(o);
        this.logger.log(`Subscribed to queue 'config'`);
      });
  }
}
