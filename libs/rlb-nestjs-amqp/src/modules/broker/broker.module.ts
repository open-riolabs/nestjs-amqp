import { RabbitMQConfig, RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BrokerConfig } from './config/broker.config';
import { BrokerService } from './services/broker.service';
import { HandlerRegistryService } from './services/handler-registry.service';
import * as amqp from 'amqplib';
import { CoreModule } from '@rlb/nestjs-core';

@Module({
  imports: [
    CoreModule,
    RabbitMQModule.forRootAsync(RabbitMQModule, {
      imports: [ConfigModule],
      useFactory: brokerFactory,
      inject: [ConfigService]
    }),
  ],
  providers: [BrokerService, HandlerRegistryService],
  exports: [BrokerService, RabbitMQModule],
})
export class BrokerModule { }

async function brokerFactory(config: ConfigService): Promise<RabbitMQConfig> {
  const cfg = config.get<BrokerConfig>('broker');
  const cred = cfg.connectionManagerOptions.connectionOptions.credentials as {
    mechanism: string; username: string; password: string; response: () => Buffer;
  };
  if (cred && cred.mechanism?.toLowerCase() === 'plain') {
    cred.response = amqp.credentials.plain(cred.username, cred.password).response;
  }
  if (cred && cred.mechanism?.toLowerCase() === 'external') {
    cred.response = amqp.credentials.external().response;
  }
  if (cred && cred.mechanism?.toLowerCase() === 'amqplain') {
    cred.response = amqp.credentials.amqplain(cred.username, cred.password).response;
  }
  return cfg;
}
