import { HttpModule } from '@nestjs/axios';
import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BrokerModule } from '../broker';
import { HttpAuthHandlerService } from './services/http-auth-handler.service';
import { HttpHandlerService } from './services/http-handler.service';
import { JwtService } from './services/jwt.service';
import { WebSocketService } from './services/websocket.service';


@Global()
@Module({
  imports: [ConfigModule, BrokerModule, HttpModule],
  providers: [HttpHandlerService, JwtService, HttpAuthHandlerService, WebSocketService],
  exports: [HttpHandlerService]
})
export class ProxyModule {

  static forRoot(providers: Provider[]): DynamicModule {

    return {
      module: ProxyModule,
      imports: [],
      providers: [...(providers || [])],
      exports: [HttpHandlerService],
    };
  }
}

