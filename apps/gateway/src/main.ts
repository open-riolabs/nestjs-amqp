import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws'; // Import the WsAdapter
import { AppConfig } from '@open-rlb/nestjs-amqp';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const appConfig = app.get<ConfigService>(ConfigService).get<AppConfig>('app');
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(3000, "0.0.0.0");
}
bootstrap();

