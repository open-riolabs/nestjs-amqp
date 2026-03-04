import { HttpService } from '@nestjs/axios';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigExt } from '../config/app-config-ext.config';

@Injectable()
export class HttpDemoService implements OnModuleInit {

  private readonly config: AppConfigExt;
  constructor(private readonly httpService: HttpService, readonly configService: ConfigService) {
    this.config = this.configService.get<AppConfigExt>('app');
  }

  async getData() {
    const url = `http://${this.config.host}:${this.config.port}/local-test/test-01`;
    const response = await this.httpService.axiosRef.post(url, { parametro: 'ciao', par3: 'val3' });
    console.log(response.data);
  }

  onModuleInit() {
    setInterval(async () => { await this.getData(); }, 10000);
  }
}