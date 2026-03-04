import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig, BrokerModule, BrokerTopic, GatewayConfig, ProxyModule } from '@open-rlb/nestjs-amqp';
import { RabbitMQConfig } from '@open-rlb/nestjs-amqp/amqp-lib/config/rabbitmq.config';
import { HandlerAuthConfig } from '@open-rlb/nestjs-amqp/modules/broker/config/handler-auth.config';
import yamlConfig from './config/config.loader';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const options = configService.get<RabbitMQConfig>('broker');
        const topics = configService.get<BrokerTopic[]>('topics');
        const app = configService.get<AppConfig>('app');
        const gateway = configService.get<GatewayConfig>('gateway');
        const authConfig = configService.get<HandlerAuthConfig[]>('auth-providers');
        return { options, topics, appOptions: app, authOptions: authConfig, gatewayOptions: gateway };
      },
    }),
    HttpModule,
    ProxyModule.forRoot([
      //{ provide: RLB_GTW_ACL_ROLE_SERVICE, useClass: AclService },
    ]),
  ],
  //providers: [ActionService, ProxyDemoService, HandlerService],
})
export class AppModule { }