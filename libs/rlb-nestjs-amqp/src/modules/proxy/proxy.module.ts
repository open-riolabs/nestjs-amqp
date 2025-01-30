import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpHandlerService } from './services/http-handler.service';
import { JwtService } from './services/jwt.service';
import { CoreModule } from '@sicilyaction/lib-nestjs-core';
import { BrokerModule } from '../broker';
import { HttpAuthHandlerService } from './services/http-auth-handler.service';

@Module({
  imports: [CoreModule, ConfigModule, BrokerModule],
  providers: [HttpHandlerService, JwtService, HttpAuthHandlerService],
  exports: [HttpHandlerService]
})
export class ProxyModule { }

