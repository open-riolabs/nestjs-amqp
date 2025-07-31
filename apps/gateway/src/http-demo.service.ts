import { HttpService } from '@nestjs/axios';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@sicilyaction/lib-nestjs-core';

@Injectable()
export class HttpDemoService implements OnModuleInit {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) { }

  private readonly config: AppConfig = this.configService.get<AppConfig>('app');

  async getData() {
    const url = `http://localhost:${this.config.port}/local-test/test-01`;
    const response = await this.httpService.axiosRef.post(url, { parametro: 'ciao', par3: 'val3' });
    console.log(response.data);
  }

  onModuleInit() {
    setInterval(async () => { await this.getData(); }, 10000);
  }
}