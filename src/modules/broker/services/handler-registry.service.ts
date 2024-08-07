import { Injectable, Logger } from "@nestjs/common";
import { BrokerEventHandler } from "../data/events/messages";

@Injectable()
export class HandlerRegistryService {

  private readonly logger: Logger

  private readonly registry: Map<string, BrokerEventHandler>

  constructor() {
    this.registry = new Map<string, BrokerEventHandler>();
    this.logger = new Logger(HandlerRegistryService.name);
  }

  public registerHandler<Payload = any, Response = any>(topic: string, handler: BrokerEventHandler<Payload, Response>): void {
    const dasherizedTopic = this.dasherizeString(topic);
    if (this.registry.has(dasherizedTopic)) {
      this.logger.error(`Handler for topic ${dasherizedTopic} already exists`);
      throw new Error(`Handler for topic ${dasherizedTopic} already exists`);
    }
    this.registry.set(topic, handler);
  }

  public getHandlers(topic: string): BrokerEventHandler {
    const handlers = this.registry.get(topic);
    return handlers;
  }

  protected dasherizeString(val: string) {
    if (!val) return;
    return val.replace(/[A-Z]/g, (char, index) => (index !== 0 ? '-' : '') + char.toLowerCase());
  }
}