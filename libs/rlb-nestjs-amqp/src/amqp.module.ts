import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BrokerModule } from './modules/broker';
import { RemoteConfigModule } from './modules/remote-config/remote-config.module';


@Module({
  imports: [
    ConfigModule,
    BrokerModule,
    RemoteConfigModule,
  ],
  exports: [
    BrokerModule,
  ]
})
export class AmqpModule { }
