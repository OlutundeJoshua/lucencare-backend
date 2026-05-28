import { NestFactory } from '@nestjs/core';
import { UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3000);
  const apiPrefix = configService.get<string>('app.apiPrefix', 'api/v1');

  app.setGlobalPrefix(apiPrefix);

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } },
    }),
  );

  app.enableCors({
    origin: configService.get<string>('app.corsOrigin', 'http://localhost:3001'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) =>
        new UnprocessableEntityException({
          errors: errors.map((e) => ({
            path: e.property,
            message: Object.values(e.constraints ?? {}).join('; '),
          })),
        }),
    }),
  );

  // Use app.get() so NestJS DI injects ClsService into both (fixes the DI gap from scaffold)
  app.useGlobalFilters(app.get(GlobalExceptionFilter));
  app.useGlobalInterceptors(app.get(TransformInterceptor));

  if (configService.get<string>('app.nodeEnv') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('LucenCare API')
      .setDescription('Consent-first health data platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
}

bootstrap();
