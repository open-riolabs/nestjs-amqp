import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  const appConfig = app.get(ConfigService).get<{ port?: number; host?: string }>('app');
  const port = Number(process.env.PORT) || appConfig?.port || 3000;
  await app.listen(port, appConfig?.host || '0.0.0.0');
}
bootstrap();
