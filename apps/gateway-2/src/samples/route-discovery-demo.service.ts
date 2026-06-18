import { Injectable } from '@nestjs/common';
import { BrokerAction, BrokerHTTP, BrokerParam } from '@open-rlb/nestjs-amqp';
import { InMemoryRouteSyncLogRepository } from '../modules/database/repository/route-sync.repository';

/**
 * Demo "microservice" living inside gateway-2. Its @BrokerHTTP/@BrokerAction routes are
 * discovered, published to the gateway (route-discovery), synced into the DB and registered
 * on Express via a reload — without touching the YAML config.
 *
 * - POST /demo-ms/echo        → synced & registered (owner 'demo-ms')
 * - GET  /health              → DELIBERATELY collides with the YAML /health route → skipped + logged
 * - GET  /demo-ms/sync-log    → reads back the persistent route-sync log
 */
@Injectable()
export class RouteDiscoveryDemoService {
  constructor(private readonly syncLog: InMemoryRouteSyncLogRepository) { }

  @BrokerAction('demo-ms', 'demo.echo', 'rpc')
  @BrokerHTTP('POST', '/demo-ms/echo', 'body', { successStatusCode: 200 })
  @BrokerHTTP('GET', '/health', 'query') // collides with the YAML /health → route-sync skips + logs it
  echo(@BrokerParam('body-full') body: any) {
    return { echo: body ?? null, handledBy: 'demo-ms' };
  }

  @BrokerAction('demo-ms', 'demo.synclog', 'rpc')
  @BrokerHTTP('GET', '/demo-ms/sync-log', 'query', { successStatusCode: 200 })
  async syncLogList() {
    return this.syncLog.list(50);
  }
}
