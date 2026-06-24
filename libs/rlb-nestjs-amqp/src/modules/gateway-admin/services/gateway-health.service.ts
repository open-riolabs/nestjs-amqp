import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AmqpConnection } from '../../../amqp-lib';
import { BrokerAction } from '../../broker';
import { GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS } from '../const';
import { GatewayHealthCheck, GatewayHealthIndicator, GatewayHealthReport, RLB_GW_HEALTH_INDICATORS } from '../health';

@Injectable()
export class GatewayHealthService {
  private readonly logger = new Logger(GatewayHealthService.name);

  constructor(
    private readonly amqp: AmqpConnection,
    @Optional() @Inject(RLB_GW_HEALTH_INDICATORS) private readonly indicators?: GatewayHealthIndicator[],
  ) { }

  /**
   * Readiness probe (gw-health): the broker connection (built-in) PLUS every dependency indicator
   * the consumer registered under RLB_GW_HEALTH_INDICATORS (database, redis, external APIs).
   * `status` is 'down' if the broker or any dependency is down. The response is always HTTP 200 with
   * this body (the gateway forwards an rpc result; it cannot set 503) — readiness checks inspect `status`.
   */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.health, 'rpc')
  async health(): Promise<GatewayHealthReport> {
    const broker = this.brokerStatus();
    const dependencies: Record<string, GatewayHealthCheck> = {};
    for (const indicator of this.indicators ?? []) {
      try {
        dependencies[indicator.name] = await indicator.check();
      } catch (e) {
        dependencies[indicator.name] = { status: 'down', detail: (e as Error)?.message };
      }
    }
    const allUp = broker.status === 'up' && Object.values(dependencies).every((d) => d.status === 'up');
    return { status: allUp ? 'up' : 'down', broker, dependencies };
  }

  /** Broker liveness from the managed connection; never throws (a thrown getter ⇒ 'down'). */
  private brokerStatus(): GatewayHealthCheck {
    try {
      return { status: this.amqp.connected ? 'up' : 'down' };
    } catch (e) {
      return { status: 'down', detail: (e as Error)?.message };
    }
  }
}
