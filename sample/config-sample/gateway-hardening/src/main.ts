import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { GatewayConfig } from '@open-rlb/nestjs-amqp';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps raw-body capture available for `parseRaw` paths.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  const appConfig = app.get(ConfigService).get<{ port?: number; host?: string }>('app');
  const gateway = app.get(ConfigService).get<GatewayConfig>('gateway');

  // HARDENING #5 (body-size limit): re-register the body parsers with the configured limit
  // (gateway.maxBodyBytes) so a huge NON-multipart body is rejected with 413 instead of being
  // buffered. This OVERRIDES the framework default (~100kb). rawBody capture keeps working.
  // Multipart uploads are bounded separately by the gateway's `upload` limits (multer).
  const limit = gateway?.maxBodyBytes;
  if (limit) {
    app.useBodyParser('json', { limit });
    app.useBodyParser('urlencoded', { extended: true, limit });
  }

  const port = Number(process.env.PORT) || appConfig?.port || 3000;
  await app.listen(port, appConfig?.host || '0.0.0.0');
}
bootstrap();
