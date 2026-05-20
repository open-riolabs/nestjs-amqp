import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BrokerService } from './broker.service';

const SHUTDOWN_TIMEOUT_MS = 25_000;

@Injectable()
export class ShutdownStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ShutdownStateService.name);
  private _isShuttingDown = false;
  private readonly drainers: Array<{ name: string; drain: () => Promise<void>; }> = [];

  constructor(private readonly brokerService: BrokerService) { }

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  register(name: string, drain: () => Promise<void>): void {
    this.drainers.push({ name, drain });
  }

  onModuleInit() {
    const handleSignal = (signal: NodeJS.Signals) => {
      if (this._isShuttingDown) return;
      this._isShuttingDown = true;
      this.logger.log(`Shutdown signal '${signal}' received.`);
      setTimeout(() => {
        this.logger.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms on ${signal}, forcing exit.`);
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS).unref();
    };
    process.once('SIGINT', () => handleSignal('SIGINT'));
    process.once('SIGTERM', () => handleSignal('SIGTERM'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.brokerService.unregisterAll();
    await this.drainAll();
  }

  private async drainAll(): Promise<void> {
    if (this.drainers.length === 0) return;
    this.logger.log(`Draining ${this.drainers.length} pipeline(s)...`);
    await Promise.all(this.drainers.map(d =>
      d.drain().catch(err => this.logger.error(`Drain failed for ${d.name}: ${err.message}`))
    ));
    this.logger.log('All pipelines drained.');
  }
}
