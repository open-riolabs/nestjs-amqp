import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BrokerAction, BrokerHTTP, BrokerParam, BrokerService } from '@open-rlb/nestjs-amqp';

interface OpResult { op: string; result: number; node: string; }

/**
 * RPC sample using the `@BrokerAction` decorator pattern.
 *
 * The MetadataScannerService walks every NestJS provider, collects methods
 * annotated with `@BrokerAction(topic, action, 'rpc')` and registers ONE
 * consumer per topic on the queue/exchange declared in `config.yaml`
 * (here: `gtw.rpc.queue` bound to `gtw.rpc` with routing key `gtw.rpc.demo`).
 * Incoming RPC messages are dispatched to the right method by their `action`
 * field, so a single topic can serve many actions.
 *
 * Parameter binding is driven by `@BrokerParam`:
 *   - 'body'      -> payload[name|argName]
 *   - 'body-full' -> the whole payload object
 *   - 'header'    -> headers[name|argName]
 *   - 'action' | 'topic' | 'tag' -> metadata of the incoming message
 *
 * `@BrokerHTTP` is informational only - it's exposed via
 * `AutoDiscoveryService.meta` for self-documentation. The real HTTP route is
 * declared in `config.yaml -> gateway.paths`.
 *
 * NOTE: do NOT also call `broker.registerRpc('rpc.demo', ...)` — it would
 * attach a second consumer to the same queue and steal half the traffic from
 * the decorator-based handler.
 */
@Injectable()
export class RpcDemoService implements OnModuleInit {

  private readonly logger = new Logger(RpcDemoService.name);

  constructor(private readonly broker: BrokerService) { }

  @BrokerAction('rpc.demo', 'add', 'rpc')
  @BrokerHTTP('POST', '/demo/rpc', 'body')
  add(
    @BrokerParam('body', 'a') a: number,
    @BrokerParam('body', 'b') b: number,
  ): OpResult {
    this.logger.log(`[rpc.add] ${a} + ${b}`);
    return { op: 'add', result: a + b, node: process.env.HOSTNAME || 'local' };
  }

  // Second action on the SAME topic - dispatched by action name.
  @BrokerAction('rpc.demo', 'multiply', 'rpc')
  multiply(
    @BrokerParam('body', 'a') a: number,
    @BrokerParam('body', 'b') b: number,
  ): OpResult {
    this.logger.log(`[rpc.multiply] ${a} * ${b}`);
    throw new Error();
    return { op: 'multiply', result: a * b, node: process.env.HOSTNAME || 'local' };
  }

  // CLIENT side: prove the round-trip without going through HTTP. Alternates
  // between the two actions so you can see the dispatch-by-action in the logs.
  onModuleInit() {
    let i = 0;
    setInterval(async () => {
      const action = i++ % 2 === 0 ? 'add' : 'multiply';
      const a = Math.floor(Math.random() * 100);
      const b = Math.floor(Math.random() * 100);
      try {
        const resp = await this.broker.requestData<{ a: number; b: number; }, OpResult>(
          'rpc.demo', action, { a, b },
        );
        this.logger.log(`[rpc] ${a} ${action} ${b} = ${resp.result} (from ${resp.node})`);
      } catch (err: any) {
        this.logger.error(`[rpc] request failed: ${err?.message ?? err}`);
      }
    }, 5000);
  }
}
