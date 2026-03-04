import { Injectable, OnModuleInit } from '@nestjs/common';
import { BrokerEvent, BrokerService } from '@open-rlb/nestjs-amqp';

@Injectable()
export class HandlerService implements OnModuleInit {

  constructor(private readonly broker: BrokerService) { }

  onModuleInit() {
    setTimeout(() => {
      this.broker.registerHandler<string>("handler-local", (payload: BrokerEvent<string>) => {
        console.log("Received payload: ", payload.payload);
      });

      this.broker.registerHandler<string>("local-bst", (payload: BrokerEvent<string>) => {
        console.log("Received broadcast: ", payload.payload);
      });
    }, 1000);


    setInterval(() => {
      this.broker.publishMessage("event-local", "grgr", "Hello from HandlerService!");
      this.broker.publishMessage("local-bst", "grgr", "Hello from HandlerService!");
    }, 1000);
  }
}
