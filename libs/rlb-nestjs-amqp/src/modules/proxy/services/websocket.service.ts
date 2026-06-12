import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { ConsumeMessage } from 'amqplib';
import { randomUUID } from 'crypto';
import { IncomingMessage } from 'http';
import { filter, lastValueFrom, Subject, Subscription } from 'rxjs';
import { WebSocketServer as Server, WebSocket } from 'ws';
import { AmqpConnection } from "../../../amqp-lib";
import { ActionPayload, BrokerConfig, BrokerEvent, BrokerService } from '../../broker';
import { RLB_AMQP_BROKER_OPTIONS, RLB_AMQP_GATEWAY_OPTIONS } from '../../broker/const';
import { ProcessedAuthData } from '..';
import { GatewayConfig, WebSocketEvent } from '../config/path-definition.config';
import { HttpAuthHandlerService } from './http-auth-handler.service';

type NamedWebSocket = WebSocket & {
  id: string;
  isAlive: boolean;
  /** Raw token from the handshake subprotocol; verified per-event at subscribe time. */
  token?: string;
  /** Memoized mapped claims, one entry per auth-provider that has verified the token. */
  authByProvider?: { [provider: string]: ProcessedAuthData; };
};

@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, transport: ['websocket'] })
export class WebSocketService implements OnModuleInit, OnModuleDestroy, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Server;
  private readonly logger = new Logger(WebSocketService.name);
  private readonly subjects: { [k: string]: Subject<any>; } = {};
  private readonly subscriptions: { [clientId: string]: { [topic: string]: Subscription; }; } = {};
  /** Merged list of configured + remotely-loaded events. */
  private wsEvents: WebSocketEvent[] = [];
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly httpClient: HttpService,
    private readonly broker: BrokerService,
    private readonly httpAuth: HttpAuthHandlerService,
    @Inject(RLB_AMQP_GATEWAY_OPTIONS) private readonly gatewayConfig: GatewayConfig,
    @Inject(RLB_AMQP_BROKER_OPTIONS) private readonly brokerConfig: BrokerConfig,
  ) { }

  // --- Gateway lifecycle -----------------------------------------------------

  afterInit(server: Server) {
    this.server = server;
    const interval = this.gatewayConfig.ws?.heartbeatIntervalMs ?? 30000;
    // Heartbeat: ping every client, terminate the ones that did not pong back.
    this.heartbeat = setInterval(() => {
      server.clients.forEach((ws: NamedWebSocket) => {
        if (ws.isAlive === false) {
          ws.terminate();
          this.handleDisconnect(ws);
          return;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* socket closing */ }
      });
    }, interval);
  }

  handleConnection(client: NamedWebSocket, request: IncomingMessage) {
    const wsCfg = this.gatewayConfig.ws;

    // Enforce the per-instance connection limit (the new socket is already in the set).
    if (wsCfg?.maxConnections && this.server?.clients && this.server.clients.size > wsCfg.maxConnections) {
      client.close(1013, 'Server busy');
      return;
    }

    client.id = randomUUID();
    client.isAlive = true;
    // Keep the raw token; it is verified per-event (with that event's provider) on subscribe.
    client.token = this.extractToken(request);
    client.on('pong', () => { client.isAlive = true; });
    client.on('message', (raw) => this.onClientMessage(client, raw));
    client.on('close', () => this.handleDisconnect(client));
    client.on('error', () => this.handleDisconnect(client));
  }

  handleDisconnect(client: NamedWebSocket) {
    const subs = this.subscriptions[client.id];
    if (subs) {
      Object.values(subs).forEach(s => s?.unsubscribe());
      delete this.subscriptions[client.id];
    }
  }

  onModuleDestroy() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const id of Object.keys(this.subscriptions)) {
      Object.values(this.subscriptions[id]).forEach(s => s?.unsubscribe());
    }
  }

  // --- Client message handling ----------------------------------------------

  private async onClientMessage(client: NamedWebSocket, raw: any) {
    let parsed: { action?: string; topic?: string; select?: { [k: string]: any; }; };
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const { action, topic, select } = parsed || {};
    if (!action || !topic) return;
    const eventDef = this.wsEvents.find(o => o.name === topic && o.type === 'ws');
    if (!eventDef) return;

    if (action === 'subscribe') {
      await this.subscribeClient(client, eventDef, select);
    } else if (action === 'unsubscribe') {
      this.subscriptions[client.id]?.[topic]?.unsubscribe();
      if (this.subscriptions[client.id]) delete this.subscriptions[client.id][topic];
      this.logger.debug(`Unsubscribed from event ${topic} for client ${client.id}`);
    }
  }

  private async subscribeClient(client: NamedWebSocket, eventDef: WebSocketEvent, select?: { [k: string]: any; }) {
    // Per-event authentication: verify the connection token with THIS event's provider
    // and map its claims. `auth` set ⇒ a valid token is required unless requireAuth === false.
    let claims: ProcessedAuthData | undefined;
    if (eventDef.auth) {
      claims = await this.resolveClaims(client, eventDef.auth);
      const required = eventDef.requireAuth !== false;
      if (required && !claims?.success) {
        this.sendError(client, eventDef.name, 'unauthorized');
        return;
      }
    }

    // Role-based authorization via the ACL service (needs an identity from `auth`).
    if (eventDef.roles?.length) {
      const provider = eventDef.auth ? this.httpAuth.findProvider(eventDef.auth) : undefined;
      let allowed = false;
      if (provider && claims?.success) {
        try {
          allowed = await this.httpAuth.checkRolesForClaims(provider, claims);
        } catch (e) {
          this.logger.error(`Role check failed for event ${eventDef.name}: ${e.message}`);
        }
      }
      if (!allowed) {
        this.sendError(client, eventDef.name, 'forbidden');
        return;
      }
    }

    // Per-client subscription limit.
    const max = this.gatewayConfig.ws?.maxSubscriptionsPerClient;
    const current = this.subscriptions[client.id] ? Object.keys(this.subscriptions[client.id]).length : 0;
    if (max && current >= max) {
      this.sendError(client, eventDef.name, 'subscription_limit');
      return;
    }

    if (!this.subjects[eventDef.name]) {
      this.sendError(client, eventDef.name, 'unknown_event');
      return;
    }
    if (!this.subscriptions[client.id]) this.subscriptions[client.id] = {};
    if (this.subscriptions[client.id][eventDef.name]) return; // already subscribed

    const scopeValue = eventDef.scopeClaim ? claims?.[eventDef.scopeClaim] : undefined;
    this.subscriptions[client.id][eventDef.name] = this.subjects[eventDef.name]
      .pipe(filter((o) => this.matches(o, select, eventDef, scopeValue)))
      .subscribe((o) => {
        client.send(JSON.stringify({
          topic: `on${eventDef.name.charAt(0).toUpperCase() + eventDef.name.slice(1)}`,
          data: o.payload || o,
        }));
      });
    this.logger.debug(`Subscribed to event ${eventDef.name} for client ${client.id}`);
  }

  /** Server-enforced per-user scope, intersected with the client-provided select. */
  private matches(o: any, select: { [k: string]: any; } | undefined, eventDef: WebSocketEvent, scopeValue: any): boolean {
    if (eventDef.scopeClaim) {
      // No identity or no payload key configured => deny by default.
      if (scopeValue === undefined || !eventDef.payloadKey) return false;
      if (!o.payload || o.payload[eventDef.payloadKey] !== scopeValue) return false;
    }
    if (select && o.payload) {
      for (const key of Object.keys(select)) {
        if (o.payload[key] !== select[key]) return false;
      }
    }
    return true;
  }

  private sendError(client: NamedWebSocket, event: string, reason: string) {
    try {
      client.send(JSON.stringify({ topic: 'onError', data: { event, error: reason } }));
    } catch { /* socket closing */ }
  }

  /**
   * Verify the connection's token against the given provider and map its claims.
   * Memoized per (connection, provider) so the same token is verified at most once
   * per provider, even across multiple subscriptions.
   */
  private async resolveClaims(client: NamedWebSocket, providerName: string): Promise<ProcessedAuthData> {
    client.authByProvider = client.authByProvider || {};
    if (client.authByProvider[providerName]) return client.authByProvider[providerName];

    const provider = this.httpAuth.findProvider(providerName);
    if (!provider) {
      this.logger.warn(`WS event auth provider '${providerName}' not found in auth-providers`);
      return (client.authByProvider[providerName] = { success: false });
    }
    const decoded = await this.httpAuth.verifyToken(provider, client.token);
    const claims = this.httpAuth.mapClaims(provider, decoded);
    return (client.authByProvider[providerName] = claims);
  }

  private extractToken(request: IncomingMessage): string | undefined {
    const proto = request.headers['sec-websocket-protocol'];
    if (!proto) return undefined;
    const parts = (Array.isArray(proto) ? proto.join(',') : proto)
      .split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return undefined;
    if (parts.length === 1) return parts[0];
    // e.g. client sends ['bearer', '<token>']
    const idx = parts.findIndex(p => p.toLowerCase() === 'bearer' || p.toLowerCase() === 'jwt');
    return idx >= 0 ? parts[idx + 1] : parts[parts.length - 1];
  }

  // --- AMQP wiring -----------------------------------------------------------

  async onModuleInit() {
    this.logger.log('Initializing WebSocket service');
    const extEvents: WebSocketEvent[] = [];
    if (this.gatewayConfig.loadConfig?.events) {
      const o = await this.broker.requestData(this.gatewayConfig.loadConfig.events.topic, this.gatewayConfig.loadConfig.events.action, {});
      extEvents.push(...o);
    }
    this.wsEvents = [...this.gatewayConfig?.events || [], ...extEvents]; // load events from config and from broker
    this.wsEvents.forEach(e => e.name = e.name.trim());

    const cname = this.brokerConfig.connectionManagerOptions.connectionOptions?.clientProperties?.connection_name;
    for (const event of this.wsEvents) {
      if (!this.subjects[event.name]) {
        this.subjects[event.name] = new Subject();
      }
      const exchange = this.brokerConfig.exchanges.find(e => e.name === event.exchange);
      if (!exchange) throw new Error(`Exchange ${event.exchange} not found in configuration for event ${event.name}`);
      if (!cname) {
        throw new Error('Client name is required for event push configuration');
      }
      if (event.exchange && event.routingKey) {
        const existingTopic = this.broker.topics.find(o => o.name === event.name);
        if (existingTopic && (existingTopic.exchange !== event.exchange || existingTopic.routingKey !== event.routingKey)) {
          this.logger.error(`Topic ${event.name} is already defined in broker configuration. This may lead to unexpected behavior.`);
        } else if (existingTopic && existingTopic.exchange === event.exchange && existingTopic.routingKey === event.routingKey && existingTopic.name !== event.name) {
          this.logger.warn(`Topic ${event.name} exists as ${existingTopic.name}. Added alias.`);
          this.broker.topics.push({ mode: 'event', name: event.name, exchange: event.exchange, routingKey: event.routingKey });
        } else if (!existingTopic) {
          this.broker.topics.push({ mode: 'event', name: event.name, exchange: event.exchange, routingKey: event.routingKey });
        }
      }
      try {
        // Per-instance, ephemeral, exclusive queue: every gateway instance gets
        // its own queue bound to the exchange, so it receives every event and
        // forwards it to the clients connected to that instance (fan-out).
        const queueName = `${event.name}-ws-${cname}-${process.pid}-${randomUUID().slice(0, 8)}`;
        await this.amqpConnection.createSubscriber<ActionPayload<Request>>(async (msg: ActionPayload<Request>, rawMessage?: ConsumeMessage, headers?: any) => {
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
          queue: queueName,
          exchange: event.exchange,
          routingKey: event.routingKey,
          createQueueIfNotExists: true,
          queueOptions: {
            durable: false,
            autoDelete: true,
            exclusive: true,
          }
        }, '', {});
        this.logger.log(`Binded event \`${event.name}\` [${event.type}] to exchange \`${exchange.name}\`, Route: \`${event.routingKey}\`, Queue: \`${queueName}\``);
      } catch (error) {
        this.logger.error(`Error subscribing to topic ${event.name}: ${error.message}`);
      }
    }

    // Forward http-type events to their configured webhook.
    const httpEvents = this.wsEvents.filter(o => o.type === 'http');
    for (const event of httpEvents) {
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
