import { Injectable, OnModuleInit } from '@nestjs/common';
import { AutoDiscoveryService } from '@open-rlb/nestjs-amqp';

@Injectable()
export class ActionService implements OnModuleInit {

  constructor(private readonly autoDiscoveryService: AutoDiscoveryService) { }
  onModuleInit() {
    console.log(JSON.stringify(this.autoDiscoveryService.meta, null, 2));
  }
}

