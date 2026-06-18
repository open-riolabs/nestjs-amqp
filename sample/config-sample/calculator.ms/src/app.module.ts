import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import yamlConfig from './config/config.loader';

import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig, BrokerModule, BrokerTopic, RabbitMQConfig } from '@open-rlb/nestjs-amqp';

@Module({
  imports: [
    // Load config/config.yaml once and expose it through @nestjs/config.
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    // Wire the AMQP broker. Route auto-discovery (publisher side) now lives INSIDE the broker
    // block (`broker.routeDiscovery`), so the factory only needs to forward `broker`/`topics`/`app`.
    // BrokerModule reads `options.routeDiscovery` itself and, because no connection_name is set
    // explicitly in the YAML, promotes `routeDiscovery.serviceName` to the AMQP connection_name.
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        options: configService.get<RabbitMQConfig>('broker')!,
        topics: configService.get<BrokerTopic[]>('topics')!,
        appOptions: configService.get<AppConfig>('app'),
      })
    }),
  ],
  providers: [AppService],
})
export class AppModule { }
