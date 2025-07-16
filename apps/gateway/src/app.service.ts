import { Injectable, OnModuleInit } from '@nestjs/common';
import { BrokerEvent, BrokerService } from '@sicilyaction/lib-nestjs-amqp';

@Injectable()
export class AppService implements OnModuleInit {

  constructor(private readonly brokerService: BrokerService) { }

  async onModuleInit() {

    setInterval(async () => {
      this.brokerService.publishMessage('sample-bst', 'action', { fefe: 'ferf' });
      const ret = await this.brokerService.requestData('local-test', 'test-01', { parametro: 'demo', par3: 'val3' });
      console.log(ret);
    }, 1000);

    await this.brokerService.registerTopic('sample-bst', (o) => {
      // console.log(o);
    });

    this.brokerService.getEvents$<any>().subscribe((event: BrokerEvent) => {
      // console.log(event);
    });
    //await this.brokerService.registerHandler<any, void>('broadcast-payment');
  }
}

