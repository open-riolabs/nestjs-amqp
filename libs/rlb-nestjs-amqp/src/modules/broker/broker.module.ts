import { ConfigurableModuleBuilder, DynamicModule, Global, Module, Provider, Type } from '@nestjs/common';
import { AmqpConnection } from '@open-rlb/nestjs-amqp/amqp-lib';
import { RabbitMQConfig } from '../../amqp-lib/config/rabbitmq.config';
import { GatewayConfig } from '../proxy';
import { HandlerAuthConfig } from './config/handler-auth.config';
import { BrokerTopic } from './config/topics.config';
import { RLB_AMQP_APP_OPTIONS, RLB_AMQP_AUTH_OPTIONS, RLB_AMQP_BROKER_OPTIONS, RLB_AMQP_GATEWAY_OPTIONS, RLB_AMQP_TOPIC_CONNECTION } from './const';
import { AutoDiscoveryService } from './services/auto-discovery.service';
import { BrokerService } from './services/broker.service';
import { HandlerRegistryService } from './services/handler-registry.service';
import { MetadataScannerService } from './services/metadata-scanner.service';
import { AppConfig, UtilsService } from './services/utils.service';
export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<RabbitMQConfig>().setClassMethodName('forRoot').build();

@Global()
@Module({
  providers: [
    AmqpConnection,
    BrokerService,
    HandlerRegistryService,
    MetadataScannerService,
    AutoDiscoveryService,
    UtilsService
  ],
  exports: [
    AmqpConnection,
    UtilsService,
    BrokerService,
    AutoDiscoveryService,
  ],
})
export class BrokerModule {
  static forRoot(
    options: RabbitMQConfig,
    topics: BrokerTopic[],
    appOptions?: AppConfig,
    authOptions?: HandlerAuthConfig[],
    gatewayOptions?: GatewayConfig
  ): DynamicModule {

    if (!options) {
      throw new Error('RabbitMQConfig is required');
    }

    if (!topics) {
      throw new Error('At least one topic is required');
    }

    const amqpOptionsProvider: Provider = { provide: RLB_AMQP_BROKER_OPTIONS, useValue: options };
    const topicOptionsProvider: Provider = { provide: RLB_AMQP_TOPIC_CONNECTION, useValue: topics };
    const appOptionsProvider: Provider = { provide: RLB_AMQP_APP_OPTIONS, useValue: appOptions };
    const authOptionsProvider: Provider = { provide: RLB_AMQP_AUTH_OPTIONS, useValue: authOptions };
    const gatewayOptionsProvider: Provider = { provide: RLB_AMQP_GATEWAY_OPTIONS, useValue: gatewayOptions };

    return {
      module: BrokerModule,
      providers: [
        amqpOptionsProvider,
        topicOptionsProvider,
        appOptionsProvider,
        authOptionsProvider,
        gatewayOptionsProvider
      ],
      exports: [
        amqpOptionsProvider,
        topicOptionsProvider,
        appOptionsProvider,
        authOptionsProvider,
        gatewayOptionsProvider
      ],
    };
  }

  static forRootAsync(asyncOptions: {
    useFactory: (...args: any[]) => Promise<{
      options: RabbitMQConfig;
      topics: BrokerTopic[];
      appOptions?: AppConfig;
      authOptions?: HandlerAuthConfig[];
      gatewayOptions?: GatewayConfig;
    }> | {
      options: RabbitMQConfig;
      topics: BrokerTopic[];
      appOptions?: AppConfig;
      authOptions?: HandlerAuthConfig[];
      gatewayOptions?: GatewayConfig;
    },
    inject?: Type<any>[],
    imports?: Type<any>[];
  }): DynamicModule {
    const amqpOptionsProvider: Provider = {
      provide: RLB_AMQP_BROKER_OPTIONS,
      useFactory: async (...args: any[]) => {
        const result = await asyncOptions.useFactory(...args);
        return result.options;
      },
      inject: asyncOptions.inject || [],
    };

    const topicOptionsProvider: Provider = {
      provide: RLB_AMQP_TOPIC_CONNECTION,
      useFactory: async (...args: any[]) => {
        const result = await asyncOptions.useFactory(...args);
        return result.topics;
      },
      inject: asyncOptions.inject || [],
    };

    const appOptionsProvider: Provider = {
      provide: RLB_AMQP_APP_OPTIONS,
      useFactory: async (...args: any[]) => {
        const result = await asyncOptions.useFactory(...args);
        return result.appOptions;
      },
      inject: asyncOptions.inject || [],
    };

    const authOptionsProvider: Provider = {
      provide: RLB_AMQP_AUTH_OPTIONS,
      useFactory: async (...args: any[]) => {
        const result = await asyncOptions.useFactory(...args);
        return result.authOptions;
      },
      inject: asyncOptions.inject || [],
    };

    const gatewayOptionsProvider: Provider = {
      provide: RLB_AMQP_GATEWAY_OPTIONS,
      useFactory: async (...args: any[]) => {
        const result = await asyncOptions.useFactory(...args);
        return result.gatewayOptions;
      },
      inject: asyncOptions.inject || [],
    };

    return {
      module: BrokerModule,
      providers: [
        amqpOptionsProvider,
        topicOptionsProvider,
        appOptionsProvider,
        authOptionsProvider,
        gatewayOptionsProvider,
      ],
      exports: [
        amqpOptionsProvider,
        topicOptionsProvider,
        appOptionsProvider,
        authOptionsProvider,
        gatewayOptionsProvider,
      ],
    };
  }
}
