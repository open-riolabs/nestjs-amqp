import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws'; // Import the WsAdapter
import { AppModule } from './app.module';
import { AppConfigExt } from './config/app-config-ext.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const appConfig = app.get<ConfigService>(ConfigService).get<AppConfigExt>('app');
  app.useWebSocketAdapter(new WsAdapter(app));
  const port = Number(process.env.PORT) || appConfig?.port || 3000;
  await app.listen(port, appConfig?.host || "0.0.0.0");
}
bootstrap();

