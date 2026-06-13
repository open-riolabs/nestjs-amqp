import { Injectable, Logger } from '@nestjs/common';
import { BrokerAction, BrokerParam } from '../../broker';
import { GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS } from '../const';
import { HttpMetric, TrackCallInput } from '../models';
import { HttpMetricRepository } from '../repository/http-metric.repository';

@Injectable()
export class GatewayMetricsService {
  private readonly logger = new Logger(GatewayMetricsService.name);

  constructor(private readonly repo: HttpMetricRepository) { }

  /** Fire-and-forget per-call event: the gateway publishes one of these per request. */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsTrack, 'event')
  async track(@BrokerParam('body-full') input: TrackCallInput): Promise<void> {
    try {
      if (!input?.method || !input?.route) return;
      await this.repo.increment(input);
    } catch (error) {
      this.logger.error(error);
    }
  }

  /** Aggregated counters for the frontend (count / errors / avg duration per route). */
  @BrokerAction(GATEWAY_ADMIN_TOPIC, GW_ADMIN_ACTIONS.metricsGet, 'rpc')
  async get(@BrokerParam('body', 'route') route?: string): Promise<(HttpMetric & { avgDurationMs: number; })[]> {
    return this.repo.list(route);
  }
}
