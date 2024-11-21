import { Injectable, OnModuleInit } from '@nestjs/common';
import { BrokerEvent, BrokerService } from '@rlb/nestjs-amqp';
import { NotFoundError } from '@rlb/nestjs-core';
import { writeFile } from 'fs/promises';

@Injectable()
export class AppService implements OnModuleInit {
  constructor(private readonly brokerService: BrokerService) { }
  async onModuleInit() {
    setInterval(async () => { }, 1000);

    await
      this.brokerService.registerRpc('local-test', async (data) => {
        switch (data.payload.action) {
          case 'test-01': {
            console.log(data.headers);
            const o = Buffer.from(data.payload.payload.$files[0].buffer, 'binary');
            await writeFile('test.pdf', o);
            return { data: 'Hello from RPC' };
          }
          case 'test-02': throw new NotFoundError('Not found');
        }
      });
    this.brokerService.getEvents$<any>().subscribe((event: BrokerEvent) => {
      console.log(event);
    });
    await this.brokerService.registerHandler<any, void>('broadcast-payment');
  }
}
