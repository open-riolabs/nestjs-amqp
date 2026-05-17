import { HttpModule } from '@nestjs/axios';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfig, BrokerModule, BrokerTopic, GatewayConfig, HandlerAuthConfig, ProxyModule, RabbitMQConfig } from '@open-rlb/nestjs-amqp';
import yamlConfig from './config/config.loader';
import { EventDemoService } from './samples/event-demo.service';
import { HandlerService } from './samples/handler.service';
import { HttpDemoService } from './samples/http-demo.service';
import { RpcDemoService } from './samples/rpc-demo.service';

const unroutableLogger = new Logger('UnroutableMonitor');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [yamlConfig] }),
    BrokerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const options = configService.get<RabbitMQConfig>('broker') as RabbitMQConfig;
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
  providers: [HandlerService, HttpDemoService, RpcDemoService, EventDemoService],
})
export class AppModule { }
