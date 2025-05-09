import { WebSocketServer, WebSocket } from 'ws';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom, Subject, Subscription } from 'rxjs';
import { IncomingMessage } from 'http';
import { ActionPayload, BrokerConfig, BrokerEvent } from '../../broker';
import { GatewayConfig } from '../config/path-definition.config';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage } from 'amqplib';


type SubscribeEvent<T = void> = { action: 'subscribe' | 'unsubscribe'; data: T; };
type NamedWebSocket = WebSocket & { id: string; };

@Injectable()
export class WebSocketService implements OnModuleInit {
  private server: WebSocketServer;
  private readonly logger = new Logger(WebSocketService.name);
  private readonly subjects: { [k: string]: Subject<any>; } = {};
  private readonly subscriptions: { [k: string]: { [k: string]: Subscription; }; } = {};
  private readonly gatewayConfig: GatewayConfig;
  private readonly brokerConfig: BrokerConfig;

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly configService: ConfigService,
    private readonly httpClient: HttpService,
  ) {
    this.brokerConfig = this.configService.get<BrokerConfig>("broker");
    this.gatewayConfig = this.configService.get<GatewayConfig>("gateway");
  }

  private handleDisconnect(client: NamedWebSocket) {
    if (this.subscriptions[client.id]) {
      Object.keys(this.subscriptions[client.id]).forEach(o => this.subscriptions[client.id][o]?.unsubscribe());
    }
  }

  private handleConnection(client: NamedWebSocket, request: IncomingMessage) {
    const { id } = this.getQueryParams(request.url);
    client.id = id;
  }

  private getQueryParams(url: string): { [k: string]: string; } {
    let hashes = url.slice(url.indexOf('?') + 1).split('&');
    let params = {};
    hashes.map((hash) => {
      let [key, val] = hash.split('=');
      params[key] = decodeURIComponent(val);
    });
    return params;
  }

  async onModuleInit() {

    for (const event of this.gatewayConfig.events) {
      if (!this.subjects[event.name]) {
        this.subjects[event.name] = new Subject();
      }
      const exchange = this.brokerConfig.exchanges.find(e => e.name === event.exchange);
      const cname = this.brokerConfig.connectionManagerOptions.connectionOptions?.clientProperties?.connection_name;
      if (!exchange) throw new Error(`Exchange ${event.exchange} not found in configuration for event ${event.name}`);
      if (!cname) {
        throw new Error('Client name is required for event push configuration');
      }

      try {
        const o = await this.amqpConnection.createSubscriber<ActionPayload<Request>>(async (msg: ActionPayload<Request>, rawMessage?: ConsumeMessage, headers?: any) => {
          const _msg: BrokerEvent<Request> = {
            topic: event.name,
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
          this.subjects[event.name].next(_msg);
        }, {
          queue: `${event.name}-ws-${cname}`,
          exchange: event.exchange,
          routingKey: event.routingKey,
          createQueueIfNotExists: true,
          queueOptions: {
            durable: false,
            autoDelete: true,
          }
        }, '', {});
        this.logger.log(`Event binded to \`${exchange.name}::${event.name}-ws-${cname}//${event.routingKey}\``);
      } catch (error) {
        this.logger.error(`Error subscribing to topic ${event.name}: ${error.message}`);
      }
    }

    if (this.gatewayConfig.events.some(o => o.type === 'ws')) {
      this.server = new WebSocketServer({ port: 8080 });
      this.server.on('connection', (server: NamedWebSocket, request) => {
        this.handleConnection(server, request);
        server.on('message', (message) => {
          const { event, data } = JSON.parse(message.toString());
          if (!event) return;
          const eventDef = this.gatewayConfig.events.find(o => o.name === event && o.type === 'ws');
          if (eventDef) {
            if (data.action === 'subscribe') {
              this.subscriptions[server.id][event] = this.subjects[event.name].subscribe((o) => {
                server.send(
                  JSON.stringify({
                    event: `on${event.charAt(0).toUpperCase() + event.slice(1)}`,
                    data: o,
                  })
                );
              });
            }
            if (data.action === 'unsubscribe') {
              this.subscriptions[server.id][event]?.unsubscribe();
            }
          }
        });

        server.on('close', () => this.handleDisconnect(server));
      });
    }

    if (this.gatewayConfig.events.some(o => o.type === 'http')) {
      const events = this.gatewayConfig.events.filter(o => o.type === 'http');
      for (const event of events) {
        this.subjects[event.name].subscribe(async (msg) => {
          const { url, method, headers } = event;
          try {
            const response = await lastValueFrom(this.httpClient.request({
              url,
              method: method.toUpperCase(),
              data: msg,
              headers
            }));
            this.logger.debug(`Event ${event.name} sent to ${url} with response ${response.status}`);
          }
          catch (error) {
            this.logger.error(`Error sending event ${event.name} to ${url}: ${error.message}`);
          }
        });
      }
    }
  }
}
