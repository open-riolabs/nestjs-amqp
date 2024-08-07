import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpHandlerService } from './services/http-handler.service';
import { JwtService } from './services/jwt.service';
import { CoreModule } from '@rlb/nestjs-core';
import { BrokerModule } from '../broker';

@Module({
  imports: [CoreModule, ConfigModule, BrokerModule],
  providers: [HttpHandlerService, JwtService],
  exports: [HttpHandlerService]
})
export class ProxyModule { }
