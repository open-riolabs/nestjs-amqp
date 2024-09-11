import { Injectable, OnModuleInit } from '@nestjs/common';
import { BrokerService } from '@rlb/nestjs-amqp';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private readonly brokerService: BrokerService) { }
  onModuleInit() {
    setInterval(async () => { }, 1000);


    this.brokerService.registerRpc('booking', async (data) => {
      return { data: 'Hello from RPC' };
    });
  }
}
