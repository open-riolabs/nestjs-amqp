import { HttpModule } from '@nestjs/axios';
import { DynamicModule, Global, Module, Provider, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HandlerAuthConfig } from '../broker/config/handler-auth.config';
import { RLB_AMQP_AUTH_OPTIONS, RLB_AMQP_GATEWAY_OPTIONS } from '../broker/const';
import { GatewayConfig } from './config/path-definition.config';
import { HttpAuthHandlerService } from './services/http-auth-handler.service';
import { HttpHandlerService } from './services/http-handler.service';
import { JwtService } from './services/jwt.service';
import { WebSocketService } from './services/websocket.service';

/** Auth-provider and gateway configuration owned by the gateway (ProxyModule). */
export interface ProxyModuleOptions {
  authOptions?: HandlerAuthConfig[];
  gatewayOptions?: GatewayConfig;
}

export interface ProxyModuleAsyncOptions {
  imports?: Type<any>[];
  inject?: Type<any>[];
  useFactory: (...args: any[]) => Promise<ProxyModuleOptions> | ProxyModuleOptions;
  /** Extra DI bindings (e.g. { provide: RLB_GTW_ACL_ROLE_SERVICE, useExisting: AclService }). */
  providers?: Provider[];
}

@Global()
@Module({
  imports: [ConfigModule, HttpModule],
  providers: [HttpHandlerService, JwtService, HttpAuthHandlerService, WebSocketService],
  exports: [HttpHandlerService]
})
export class ProxyModule {

  /**
   * Synchronous setup. Owns the gateway's auth-providers and gateway config (moved here
   * from BrokerModule) and accepts extra DI bindings such as the ACL role service.
   */
  static forRoot(options: ProxyModuleOptions = {}, providers: Provider[] = []): DynamicModule {
    const authOptionsProvider: Provider = { provide: RLB_AMQP_AUTH_OPTIONS, useValue: options.authOptions };
    const gatewayOptionsProvider: Provider = { provide: RLB_AMQP_GATEWAY_OPTIONS, useValue: options.gatewayOptions };
    return {
      module: ProxyModule,
      providers: [authOptionsProvider, gatewayOptionsProvider, ...(providers || [])],
      exports: [HttpHandlerService, authOptionsProvider, gatewayOptionsProvider],
    };
  }

  /**
   * Async setup: resolve auth-providers / gateway config from a factory (e.g. ConfigService).
   * `providers` are added as-is for non-config bindings (ACL role service, etc.).
   */
  static forRootAsync(asyncOptions: ProxyModuleAsyncOptions): DynamicModule {
    const authOptionsProvider: Provider = {
      provide: RLB_AMQP_AUTH_OPTIONS,
      useFactory: async (...args: any[]) => (await asyncOptions.useFactory(...args)).authOptions,
      inject: asyncOptions.inject || [],
    };
    const gatewayOptionsProvider: Provider = {
      provide: RLB_AMQP_GATEWAY_OPTIONS,
      useFactory: async (...args: any[]) => (await asyncOptions.useFactory(...args)).gatewayOptions,
      inject: asyncOptions.inject || [],
    };
    return {
      module: ProxyModule,
      imports: asyncOptions.imports || [],
      providers: [authOptionsProvider, gatewayOptionsProvider, ...(asyncOptions.providers || [])],
      exports: [HttpHandlerService, authOptionsProvider, gatewayOptionsProvider],
    };
  }
}
