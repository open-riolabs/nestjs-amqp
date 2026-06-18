import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BrokerEvent, BrokerService } from '@open-rlb/nestjs-amqp';

interface EventPayload { user: string; action: string; ts: number; }

/**
 * EVENT sample.
 *
 * Difference vs. broadcast: a real durable queue is declared in config
 * (`gtw.events.queue`) and bound to `gtw.events` once. Every publish on
 * `event.demo` is enqueued there and consumed by ONE worker at a time
 * (competing consumers). Survives broker restarts because both the queue is
 * durable and the publisher sends with `persistent: true`.
 *
 * Publisher side -> topic `event.demo` (mode=event)
 * Consumer side  -> topic `event.demo.consumer` (mode=handle, reads from
 *                   `gtw.events.queue`)
 *
 * The HTTP endpoint `POST /demo/event` (see config.yaml `gateway.paths`)
 * publishes the same topic, so HttpDemoService can drive it externally.
 */
@Injectable()
export class EventDemoService implements OnModuleInit {

  private readonly logger = new Logger(EventDemoService.name);

  constructor(private readonly broker: BrokerService) { }

  onModuleInit() {
    // CONSUMER side: handle mode reads from gtw.events.queue.
    this.broker.registerHandler<EventPayload>('event.demo.consumer', (event: BrokerEvent<EventPayload>) => {
      this.logger.log(`[event] received action="${event.action}" payload=${JSON.stringify(event.payload)}`);
    });

    // PUBLISHER side: periodic event publish.
    setInterval(() => {
      const payload: EventPayload = {
        user: `user-${Math.floor(Math.random() * 1000)}`,
        action: 'page.view',
        ts: Date.now(),
      };
      this.broker
        .publishMessage('event.demo', 'event.demo.action', payload)
        .catch(err => this.logger.error(`[event] publish failed: ${err.message}`));
    }, 4000);

    // UNROUTABLE DEMO: publishes on `unroutable.demo` (gtw.events exchange,
    // routing key `void.no.binding` — no queue is bound to it) with
    // `mandatory: true`. The broker returns the message and AmqpConnection's
    // `'return'` listener emits a WARN like:
    //   Unrouted message returned on channel "..." - exchange: "gtw.events",
    //   routingKey: "void.no.binding", replyCode: 312, replyText: "NO_ROUTE", ...
    // The publish itself does NOT throw: a returned message is a successful
    // publish from the channel's PoV, just unrouted at the broker.
    setInterval(() => {
      this.broker
        .publishMessage('unroutable.demo', 'tick', { ts: Date.now() })
        .catch(err => this.logger.error(`[unroutable] publish failed: ${err.message}`));
    }, 8000);
  }
}
