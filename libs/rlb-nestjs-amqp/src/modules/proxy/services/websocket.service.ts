import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { AppConfig } from '@sicilyaction/lib-nestjs-core';
import { ConsumeMessage } from 'amqplib';
import { IncomingMessage } from 'http';
import { filter, lastValueFrom, Subject, Subscription } from 'rxjs';
import { WebSocketServer as Server, WebSocket } from 'ws';
import { ActionPayload, BrokerConfig, BrokerEvent, BrokerService } from '../../broker';
import { GatewayConfig, WebSocketEvent } from '../config/path-definition.config';

type SubscribeEvent<T = void> = { action: 'subscribe' | 'unsubscribe'; data: T; };
type NamedWebSocket = WebSocket & { id: string; };

@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, transport: ['websocket'] })
export class WebSocketService implements OnModuleInit {
  @WebSocketServer()
  private server: Server;
  private readonly logger = new Logger(WebSocketService.name);
  private readonly subjects: { [k: string]: Subject<any>; } = {};
  private readonly subscriptions: { [k: string]: { [k: string]: Subscription; }; } = {};
  private readonly gatewayConfig: GatewayConfig;
  private readonly brokerConfig: BrokerConfig;
  private readonly appConfig: AppConfig;

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly configService: ConfigService,
    private readonly httpClient: HttpService,
    private readonly broker: BrokerService
  ) {
    this.brokerConfig = this.configService.get<BrokerConfig>("broker");
    this.gatewayConfig = this.configService.get<GatewayConfig>("gateway");
    this.appConfig = this.configService.get<AppConfig>("app");
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
    this.logger.log('Initializing WebSocket service');
    const extEvents: WebSocketEvent[] = [];
    if (this.gatewayConfig.loadConfig?.events) {
      const o = await this.broker.requestData(this.gatewayConfig.loadConfig.events.topic, this.gatewayConfig.loadConfig.events.action, {});
      extEvents.push(...o);
    }
    const events = [...this.gatewayConfig?.events || [], ...extEvents];
    for (const event of events) {
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
        this.logger.log(`Binded event \`${event.name}\` to exchange \`${exchange.name}\`, Route: \`${event.routingKey}\``);
      } catch (error) {
        this.logger.error(`Error subscribing to topic ${event.name}: ${error.message}`);
      }
    }

    if (this.gatewayConfig.events.some(o => o.type === 'ws')) {
      this.server.on('connection', (server: NamedWebSocket, request) => {
        this.handleConnection(server, request);
        server.on('message', (message) => {
          const { action, topic, select } = JSON.parse(message.toString());
          if (!action) return;
          const eventDef = this.gatewayConfig.events.find(o => o.name === topic && o.type === 'ws');
          if (eventDef) {
            if (action === 'subscribe') {
              if (!this.subscriptions[server.id]) this.subscriptions[server.id] = {};
              this.subscriptions[server.id][topic] = this.subjects[topic]
                .pipe(filter((o) => {
                  if (select && o.payload) {
                    for (const key of Object.keys(select)) {
                      if (o.payload[key] !== select[key]) return false;
                    }
                  }
                  return true;
                }))
                .subscribe((o) => {
                  server.send(
                    JSON.stringify({
                      topic: `on${topic.charAt(0).toUpperCase() + topic.slice(1)}`,
                      data: o.payload || o,
                    })
                  );
                });
              this.logger.debug(`Subscribed to event ${topic} for client ${server.id}`);
            }
            if (action === 'unsubscribe') {
              this.subscriptions[server.id][topic]?.unsubscribe();
              this.logger.debug(`Unsubscribed from event ${topic} for client ${server.id}`);
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
              headers,
              timeout: event.timeout || this.brokerConfig.defaultRpcTimeout || 10000,
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
