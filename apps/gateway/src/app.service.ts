import { Injectable, OnModuleInit } from '@nestjs/common';
import { BrokerEvent, BrokerService } from '@sicilyaction/lib-nestjs-amqp';
import { NotFoundError } from '@sicilyaction/lib-nestjs-core';
import { writeFile } from 'fs/promises';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private readonly brokerService: BrokerService) { }
  async onModuleInit() {
    setInterval(async () => {
      try {
        // const o = await this.brokerService.requestData('local-test', 'test-01', { fefe: 'ferf' });
        // console.log('Response from test-01:', o);

      } catch (error) {
        console.error('Error occurred while requesting data from test-01:', error.message);
      }
    }, 1000);


  }
}

