import { HttpService } from '@nestjs/axios';
import { Injectable, OnModuleInit } from '@nestjs/common';

@Injectable()
export class ProxyDemoService implements OnModuleInit {
  constructor(private readonly httpService: HttpService) { }

  async getData() {
    const url = `http://localhost:${3000}/test-local/test-01`;
    const response = await this.httpService.axiosRef.post(url, { parametro: 'ciao', par3: 'val3' });
    console.log(response.data);
  }

  onModuleInit() {
    //setInterval(async () => { await this.getData(); }, 10000);
  }
}