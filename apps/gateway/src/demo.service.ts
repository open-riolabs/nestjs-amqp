import { Injectable, OnModuleInit } from '@nestjs/common';
import { BrokerAction, BrokerAuth, BrokerHTTP, BrokerParam } from '@sicilyaction/lib-nestjs-amqp';
import { AutoDiscoveryService } from '@sicilyaction/lib-nestjs-amqp/modules/broker/services/auto-discovery.service';

@Injectable()
export class DemoService implements OnModuleInit {

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



  // @BrokerAction('rlb-admin', 'user-acl-list')
  // async filterUsers(
  //     @BrokerParam('body-full') query: any,
  //     @BrokerParam('body', 'page') page: number = 1,
  //     @BrokerParam('body', 'limit') limit: number = 10,
  // ): Promise<any> {
  //     try {
  //         console.log(query, page, limit);
  //         return;
  //     } catch (error) {
  //         throw error;
  //     }
  // }
}

