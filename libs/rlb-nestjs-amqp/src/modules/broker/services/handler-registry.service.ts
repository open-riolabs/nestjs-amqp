import { Injectable, Logger } from "@nestjs/common";
import { RpcEventHandler } from "../data/events/messages";

@Injectable()
export class HandlerRegistryService {

  private readonly logger: Logger

  private readonly registry: Map<string, RpcEventHandler>
  private readonly rpcRegistry: Map<string, RpcEventHandler>

  constructor() {
    this.registry = new Map<string, RpcEventHandler>();
    this.rpcRegistry = new Map<string, RpcEventHandler>();
    this.logger = new Logger(HandlerRegistryService.name);
  }

  public registerHandler<Payload = any, Response = any>(type: 'fun', topic: string, handler: RpcEventHandler<Payload, Response>): void;
  public registerHandler<Payload = any, Response = any>(type: 'rpc', topic: string, handler: RpcEventHandler<Payload, Response>): void;
  public registerHandler<Payload = any, Response = any>(type: 'fun' | 'rpc', topic: string, handler: RpcEventHandler<Payload, Response> | RpcEventHandler<Payload, Response>): void {
    const dasherizedTopic = this.dasherizeString(topic);
    if (type as any === 'fun') {
      if (this.registry.has(dasherizedTopic)) {
        this.logger.error(`Handler for topic ${dasherizedTopic} already exists`);
        throw new Error(`Handler for topic ${dasherizedTopic} already exists`);
      }
      this.registry.set(topic, handler);
    }
    if (type === 'rpc') {
      if (this.rpcRegistry.has(dasherizedTopic)) {
        this.logger.error(`Handler for topic ${dasherizedTopic} already exists`);
        throw new Error(`Handler for topic ${dasherizedTopic} already exists`);
      }
      this.rpcRegistry.set(topic, handler as RpcEventHandler<Payload, Response>);
    }
  }

  public getHandlers(type: 'fun', topic: string): RpcEventHandler;
  public getHandlers(type: 'rpc', topic: string): RpcEventHandler
  public getHandlers(type: 'fun' | 'rpc', topic: string): RpcEventHandler | RpcEventHandler {
    if (type === 'fun') {
      return this.registry.get(topic);
    }
    if (type === 'rpc') {
      return this.rpcRegistry.get(topic);
    }
    throw new Error(`Invalid registry type ${type}`);
  }

  protected dasherizeString(val: string) {
    if (!val) return;
    return val.replace(/[A-Z]/g, (char, index) => (index !== 0 ? '-' : '') + char.toLowerCase());
  }
}