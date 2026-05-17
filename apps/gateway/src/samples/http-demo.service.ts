import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfigExt } from '../config/app-config-ext.config';

/**
 * HTTP-proxy sample.
 *
 * Drives the gateway endpoints declared in `config.yaml -> gateway.paths`:
 *   - POST /demo/rpc   -> broker.requestData('rpc.demo', 'rpc.demo.action', body)
 *                        the gateway returns the RPC response in the HTTP body
 *   - POST /demo/event -> broker.publishMessage('event.demo', 'event.demo.action', body)
 *                        the gateway returns 2xx immediately (publish only)
 *
 * The RPC server is RpcDemoService and the event consumer is EventDemoService,
 * both living in this same gateway process. In a real deployment they would be
 * separate microservices.
 */
@Injectable()
export class HttpDemoService implements OnModuleInit {

  private readonly logger = new Logger(HttpDemoService.name);
  private baseUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) { }

  onModuleInit() {
    const app = this.configService.get<AppConfigExt>('app');
    // main.ts listens on a fixed port (3000). The config 'app.port' is the
    // logical port advertised in config; use whichever your gateway is bound
    // to. We default to 3000 to match main.ts.
    const port = app?.port ?? 3000;
    this.baseUrl = `http://localhost:${port}`;

    // Stagger the first invocation so the broker connections + RPC consumer
    // are ready (registerRpc happens in another sample at module init).
    setTimeout(() => {
      setInterval(() => this.callRpc(), 6000);
      setInterval(() => this.publishEvent(), 7000);
    }, 2000);
  }

  private async callRpc() {
    const body = { a: 7, b: Math.floor(Math.random() * 10) };
    try {
      const res = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/demo/rpc`, body),
      );
      this.logger.log(`[http-rpc] POST /demo/rpc body=${JSON.stringify(body)} -> ${JSON.stringify(res.data)}`);
    } catch (err: any) {
      this.logger.error(`[http-rpc] failed: ${err?.message ?? err}`);
    }
  }

  private async publishEvent() {
    const body = { user: 'http-client', action: 'click', ts: Date.now() };
    try {
      const res = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/demo/event`, body),
      );
      this.logger.log(`[http-event] POST /demo/event body=${JSON.stringify(body)} -> status=${res.status}`);
    } catch (err: any) {
      this.logger.error(`[http-event] failed: ${err?.message ?? err}`);
    }
  }
}
