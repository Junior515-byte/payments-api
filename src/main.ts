import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { AppConfig } from './config/app-config';

async function bootstrap() {
  // rawBody: necesario para verificar la firma HMAC sobre los bytes exactos recibidos.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  setupSwagger(app);
  await app.listen(app.get(AppConfig).port);
}

void bootstrap();
