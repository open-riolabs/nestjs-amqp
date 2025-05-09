import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpHandlerService } from './services/http-handler.service';
import { JwtService } from './services/jwt.service';
import { CoreModule } from '@sicilyaction/lib-nestjs-core';
import { BrokerModule } from '../broker';
import { HttpAuthHandlerService } from './services/http-auth-handler.service';
import { WebSocketService } from './services/websocket.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [CoreModule, ConfigModule, BrokerModule, HttpModule],
  providers: [HttpHandlerService, JwtService, HttpAuthHandlerService, WebSocketService],
  exports: [HttpHandlerService]
})
export class ProxyModule { }

