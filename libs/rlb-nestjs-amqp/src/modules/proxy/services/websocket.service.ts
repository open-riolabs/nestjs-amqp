import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { ConsumeMessage } from 'amqplib';
import { randomUUID } from 'crypto';
import { IncomingMessage } from 'http';
import { filter, lastValueFrom, Subject, Subscription } from 'rxjs';
import { WebSocketServer as Server, WebSocket } from 'ws';
import { ProcessedAuthData } from '..';
import { AmqpConnection } from "../../../amqp-lib";
import { ActionPayload, BrokerConfig, BrokerEvent, BrokerService } from '../../broker';
import { RLB_AMQP_BROKER_OPTIONS, RLB_AMQP_GATEWAY_OPTIONS } from '../../broker/const';
import { GatewayConfig, WebSocketEvent } from '../config/path-definition.config';
import { HttpAuthHandlerService } from './http-auth-handler.service';

type NamedWebSocket = WebSocket & {
  id: string;
  isAlive: boolean;
  /** Raw token from the handshake subprotocol; verified per-event at subscribe time. */
  token?: string;
  /** Token `exp` (epoch seconds) captured on first verification; bounds the session. */
  tokenExp?: number;
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
    // Heartbeat: ping every client, drop dead ones AND close sessions whose token expired.
    this.heartbeat = setInterval(() => {
      server.clients.forEach((sock) => {
        const ws = sock as NamedWebSocket;
        if (this.isExpired(ws)) {
          this.closeExpired(ws);
          return;
        }
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

    // Reject cross-origin handshakes when an allowlist is configured.
    if (wsCfg?.allowedOrigins?.length) {
      const origin = request.headers.origin;
      if (!origin || !wsCfg.allowedOrigins.includes(origin)) {
        client.close(1008, 'Origin not allowed');
        return;
      }
    }

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

  /** True once the connection's token (if any) has passed its `exp`. */
  private isExpired(client: NamedWebSocket): boolean {
    return client.tokenExp != null && Date.now() >= client.tokenExp * 1000;
  }

  private closeExpired(client: NamedWebSocket) {
    this.handleDisconnect(client);
    try { client.close(1008, 'token expired'); } catch { /* socket closing */ }
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
    // Expired session: close instead of processing further frames.
    if (this.isExpired(client)) {
      this.closeExpired(client);
      return;
    }
    // Drop oversized frames before parsing (cheap DoS guard).
    const maxBytes = this.gatewayConfig.ws?.maxMessageBytes ?? 16384;
    const size = typeof raw === 'string' ? Buffer.byteLength(raw) : (raw?.length ?? 0);
    if (size > maxBytes) {
      this.logger.warn(`Dropped oversized WS message (${size}B > ${maxBytes}B) from client ${client.id}`);
      return;
    }
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

    // Action-based authorization via the ACL service (needs an identity from `auth`). WS events
    // carry no HTTP resource, so the check is resource-agnostic (no ctx → match any grant).
    if (eventDef.actions?.length) {
      const provider = eventDef.auth ? this.httpAuth.findProvider(eventDef.auth) : undefined;
      let allowed = false;
      if (provider && claims?.success) {
        try {
          allowed = await this.httpAuth.checkActionsForClaims(provider, claims, eventDef.actions);
        } catch (e) {
          this.logger.error(`Authorization check failed for event ${eventDef.name}: ${e.message}`);
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
    const maxBuffered = this.gatewayConfig.ws?.maxBufferedBytes ?? 1048576; // 1 MiB
    let saturated = false; // logs only on state transitions, not per dropped message
    this.subscriptions[client.id][eventDef.name] = this.subjects[eventDef.name]
      .pipe(filter((o) => this.matches(o, select, eventDef, scopeValue)))
      .subscribe((o) => {
        // Stop delivering (and close) the moment the token's lifetime ends.
        if (this.isExpired(client)) {
          this.closeExpired(client);
          return;
        }
        // Send only on live sockets: ws buffers writes on CONNECTING/CLOSING sockets too.
        if (client.readyState !== WebSocket.OPEN) return;
        // Outbound backpressure: a slow-but-alive client (answers pongs, never drains) grows
        // `bufferedAmount` in gateway RAM without bound. Above the cap, drop THIS message for
        // THIS client; delivery resumes once the client drains below the cap.
        if (client.bufferedAmount > maxBuffered) {
          if (!saturated) {
            saturated = true;
            this.logger.warn(`[WS] client ${client.id} saturated on event '${eventDef.name}' (${client.bufferedAmount}B buffered > ${maxBuffered}B): dropping messages until it drains`);
          }
          return;
        }
        if (saturated) {
          saturated = false;
          this.logger.log(`[WS] client ${client.id} drained: resuming delivery for event '${eventDef.name}'`);
        }
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
    // Capture the token expiry once: it bounds the whole WS session lifetime.
    if (decoded?.exp && client.tokenExp == null) {
      client.tokenExp = decoded.exp;
    }
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
      const src = this.gatewayConfig.loadConfig.events;
      // Fail-soft like the HTTP paths pull: a slow/down events source (microservice or its
      // DB) must degrade to YAML-only events, NOT abort onModuleInit and kill the whole
      // gateway at boot. Remote events stay missing until a restart — logged loudly.
      try {
        const o = await this.broker.requestData(src.topic, src.action, {});
        if (Array.isArray(o)) {
          extEvents.push(...o);
        } else {
          this.logger.warn(`[WS] events source ${src.topic}/${src.action} returned a non-array reply; ignoring it.`);
        }
      } catch (error) {
        this.logger.warn(`[WS] failed to pull remote events (${src.topic}/${src.action}): ${error?.message}. Keeping YAML events only — remote events will be missing until restart.`);
      }
    }
    this.wsEvents = [...this.gatewayConfig?.events || [], ...extEvents]; // load events from config and from broker
    this.wsEvents.forEach(e => e.name = e.name.trim());

    if (!this.gatewayConfig.ws?.allowedOrigins?.length) {
      this.logger.warn('gateway.ws.allowedOrigins not set: WebSocket handshakes are accepted from any Origin.');
    }
    // Security sanity checks for each ws event.
    for (const e of this.wsEvents.filter(o => o.type === 'ws')) {
      if (e.auth && !this.httpAuth.findProvider(e.auth)) {
        this.logger.error(`WS event '${e.name}' references unknown auth provider '${e.auth}'; subscriptions will be denied.`);
      }
      if (e.actions?.length && !e.auth) {
        this.logger.error(`WS event '${e.name}' declares actions but no 'auth' provider; the authorization check cannot identify the subscriber and every subscription will be denied. Set 'auth' to enable authorization checks.`);
      }
      if (e.auth && e.requireAuth !== false && !(e.scopeClaim && e.payloadKey)) {
        this.logger.warn(`WS event '${e.name}' has auth but no scopeClaim/payloadKey: every authorized subscriber receives ALL messages (no per-user isolation).`);
      }
    }

    const cname = this.brokerConfig.connectionManagerOptions.connectionOptions?.clientProperties?.connection_name;
    for (const event of this.wsEvents) {
      if (!this.subjects[event.name]) {
        this.subjects[event.name] = new Subject();
      }
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
        this.logger.log(`Binded event \`${event.name}\` [${event.type}] to exchange \`${event.exchange}\`, Route: \`${event.routingKey}\`, Queue: \`${queueName}\``);
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
