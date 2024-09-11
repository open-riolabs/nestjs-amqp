import { Injectable, OnModuleInit } from '@nestjs/common';
import { BrokerService } from '@rlb/nestjs-amqp';
import { NotFoundError } from '@rlb/nestjs-core';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private readonly brokerService: BrokerService) { }
  onModuleInit() {
    setInterval(async () => { }, 1000);


    this.brokerService.registerRpc('local-test', async (data) => {
      switch (data.payload.action) {
        case 'test-01': return { data: 'Hello from RPC' };
        case 'test-02': throw new NotFoundError('Not found');
      }
    });
  }
}
