import { Injectable, OnModuleInit } from '@nestjs/common';
import { AutoDiscoveryService, BrokerAction, BrokerAuth, BrokerHTTP, BrokerParam } from '@open-rlb/nestjs-amqp';

@Injectable()
export class ActionFederatedService implements OnModuleInit {

  constructor(private readonly autoDiscoveryService: AutoDiscoveryService) { }

  @BrokerAction('local-test', 'test-01', 'rpc')
  @BrokerAuth('rlb-gateway', true, ['admin'])
  @BrokerHTTP('POST', '/demo/pippo', 'body', 5000, true)
  pippo(
    @BrokerParam("header", "X-GTW-AUTH-USERID") userId: string,
    @BrokerParam("body", "parametro") par2: string,
    par3: string) {
    console.log(userId, par2, par3);
    return "ok";
  }

  onModuleInit() {
    console.log(JSON.stringify(this.autoDiscoveryService.meta, null, 2));
  }
}

