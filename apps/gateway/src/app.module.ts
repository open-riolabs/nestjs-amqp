import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { AppService } from './app.service';
import { CoreModule } from '@sicilyaction/lib-nestjs-core';
import { BrokerModule, RemoteConfigModule, ProxyModule } from '@sicilyaction/lib-nestjs-amqp';

@Module({
  imports: [
    TerminusModule,
    CoreModule,
    BrokerModule,
    ProxyModule,
    RemoteConfigModule,
  ],
  controllers: [],
  providers: [AppService],
})
export class AppModule { }

