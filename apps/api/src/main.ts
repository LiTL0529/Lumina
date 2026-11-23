import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
    }),
  );

  const port = Number(process.env.API_PORT || 3100);
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Lumina Traceability & ERP API running at http://0.0.0.0:${port}/api/v1`);
}

bootstrap();
