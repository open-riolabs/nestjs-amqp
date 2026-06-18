import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Pure AMQP microservice bootstrap — there is NO HTTP server here (no `app.listen()`).
 * The @BrokerAction handlers in {@link AppService} start consuming from RabbitMQ as soon as the
 * application is initialized. The matching @BrokerHTTP metadata is what a gateway picks up over
 * route auto-discovery (see config/config.yaml → broker.routeDiscovery) to publish HTTP routes.
 *
 * `enableShutdownHooks()` lets BrokerModule drain in-flight RPC work and close the AMQP
 * connection cleanly when the process receives SIGINT/SIGTERM.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.init();
}
bootstrap();
