import { ConfigurableModuleBuilder, DynamicModule, Global, Module, Provider, Type } from '@nestjs/common';
import { AmqpConnection } from '@open-rlb/nestjs-amqp/amqp-lib';
import { RabbitMQConfig } from '../../amqp-lib/config/rabbitmq.config';
import { BrokerTopic } from './config/topics.config';
import { RLB_AMQP_APP_OPTIONS, RLB_AMQP_BROKER_OPTIONS, RLB_AMQP_TOPIC_CONNECTION, RLB_ROUTE_DISCOVERY_OPTIONS } from './const';
import { AutoDiscoveryService } from './services/auto-discovery.service';
import { BrokerService } from './services/broker.service';
import { HandlerRegistryService } from './services/handler-registry.service';
import { MetadataScannerService } from './services/metadata-scanner.service';
import { RouteDiscoveryPublisherService } from './services/route-discovery-publisher.service';
import { ShutdownStateService } from './services/shutdown-state.service';
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
    ShutdownStateService,
    AutoDiscoveryService,
    RouteDiscoveryPublisherService,
    UtilsService
  ],
  exports: [
    AmqpConnection,
    UtilsService,
    BrokerService,
    AutoDiscoveryService,
    RouteDiscoveryPublisherService,
    ShutdownStateService
  ],
})
export class BrokerModule {
  /**
   * Microservice route-discovery lives INSIDE the broker config (`options.routeDiscovery`). When it
   * carries a `serviceName` and no AMQP connection_name is set explicitly, the serviceName is used
   * as the connection_name — so a publishing microservice configures one name, not two.
   */
  private static withServiceNameConnection(options: RabbitMQConfig): RabbitMQConfig {
    const serviceName = options?.routeDiscovery?.serviceName;
    if (!serviceName) return options;
    const cmo: any = options.connectionManagerOptions || {};
    const co: any = cmo.connectionOptions || {};
    const cp: any = co.clientProperties || {};
    if (cp.connection_name) return options; // an explicit connection_name always wins
    return {
      ...options,
      connectionManagerOptions: {
        ...cmo,
        connectionOptions: { ...co, clientProperties: { ...cp, connection_name: serviceName } },
      },
    } as RabbitMQConfig;
  }

  static forRoot(
    options: RabbitMQConfig,
    topics: BrokerTopic[],
    appOptions?: AppConfig,
  ): DynamicModule {

    if (!options) {
      throw new Error('RabbitMQConfig is required');
    }

    if (!topics) {
      throw new Error('At least one topic is required');
    }

    const opts = BrokerModule.withServiceNameConnection(options);
    const amqpOptionsProvider: Provider = { provide: RLB_AMQP_BROKER_OPTIONS, useValue: opts };
    const topicOptionsProvider: Provider = { provide: RLB_AMQP_TOPIC_CONNECTION, useValue: topics };
    const appOptionsProvider: Provider = { provide: RLB_AMQP_APP_OPTIONS, useValue: appOptions };
    const routeDiscoveryProvider: Provider = { provide: RLB_ROUTE_DISCOVERY_OPTIONS, useValue: opts.routeDiscovery };

    return {
      module: BrokerModule,
      providers: [
        amqpOptionsProvider,
        topicOptionsProvider,
        appOptionsProvider,
        routeDiscoveryProvider,
      ],
      exports: [
        amqpOptionsProvider,
        topicOptionsProvider,
        appOptionsProvider,
        routeDiscoveryProvider,
      ],
    };
  }

  static forRootAsync(asyncOptions: {
    useFactory: (...args: any[]) => Promise<{
      options: RabbitMQConfig;
      topics: BrokerTopic[];
      appOptions?: AppConfig;
    }> | {
      options: RabbitMQConfig;
      topics: BrokerTopic[];
      appOptions?: AppConfig;
    },
    inject?: Type<any>[],
    imports?: Type<any>[];
  }): DynamicModule {
    const amqpOptionsProvider: Provider = {
      provide: RLB_AMQP_BROKER_OPTIONS,
      useFactory: async (...args: any[]) => {
        const result = await asyncOptions.useFactory(...args);
        return BrokerModule.withServiceNameConnection(result.options);
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

    const routeDiscoveryProvider: Provider = {
      provide: RLB_ROUTE_DISCOVERY_OPTIONS,
      useFactory: async (...args: any[]) => {
        const result = await asyncOptions.useFactory(...args);
        return result.options?.routeDiscovery;
      },
      inject: asyncOptions.inject || [],
    };

    return {
      module: BrokerModule,
      providers: [
        amqpOptionsProvider,
        topicOptionsProvider,
        appOptionsProvider,
        routeDiscoveryProvider,
      ],
      exports: [
        amqpOptionsProvider,
        topicOptionsProvider,
        appOptionsProvider,
        routeDiscoveryProvider,
      ],
    };
  }
}
