import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BrokerEvent, BrokerService } from '@open-rlb/nestjs-amqp';

/**
 * BROADCAST sample.
 *
 * Demonstrates fan-out delivery: every running instance of the gateway that
 * calls `registerHandler('broadcast.demo', ...)` gets its own durable queue
 * (`broadcast.demo-<connection_name>`) bound to the `gtw.broadcast` exchange
 * on routing key `gtw.broadcast.demo`. A publish on the same topic is
 * delivered to every consumer instance.
 */
@Injectable()
export class HandlerService implements OnModuleInit {

  private readonly logger = new Logger(HandlerService.name);

  constructor(private readonly broker: BrokerService) { }

  onModuleInit() {
    // Subscribe first so subsequent publishes are routable.
    this.broker.registerHandler<string>('broadcast.demo', (event: BrokerEvent<string>) => {
      this.logger.log(`[broadcast] received action="${event.action}" payload="${event.payload}"`);
    });

    // Periodic publish. publishMessage is async since the publisher confirm
    // is awaited; we MUST handle the promise to avoid UnhandledPromiseRejection.
    setInterval(() => {
      const payload = `tick @ ${new Date().toISOString()}`;
      this.broker
        .publishMessage('broadcast.demo', 'tick', payload)
        .catch(err => this.logger.error(`[broadcast] publish failed: ${err.message}`));
    }, 3000);
  }
}
