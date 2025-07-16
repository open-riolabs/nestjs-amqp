import { Module } from '@nestjs/common';
import { BrokerModule, ProxyModule, RLB_GTW_ACL_ROLE_SERVICE } from '@sicilyaction/lib-nestjs-amqp';
import { CoreModule } from '@sicilyaction/lib-nestjs-core';
import { AclService } from './acl.service';
import { AppService } from './app.service';
import { DemoService } from './demo.service';
import { Demo2Service } from './demo2.service';

@Module({
  imports: [
    CoreModule,
    BrokerModule,
    ProxyModule.forRoot([
      { provide: RLB_GTW_ACL_ROLE_SERVICE, useClass: AclService },
    ]),
  ],
  controllers: [],
  providers: [AppService, DemoService, Demo2Service],
})
export class AppModule { }

