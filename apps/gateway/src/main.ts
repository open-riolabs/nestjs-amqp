import { NestFactory } from '@nestjs/core';

import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@rlb/nestjs-core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const appConfig = app.get<ConfigService>(ConfigService).get<AppConfig>('app');
  await app.listen(appConfig.port, appConfig.host);
}
bootstrap();
