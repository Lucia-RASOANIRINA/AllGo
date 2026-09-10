import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { ResponseInterceptor } from './common/http/response.interceptor';

async function bootstrap(): Promise<void> {
  // `rawBody` : la vérification de signature des rappels mobile money exige le
  // corps reçu octet pour octet — re-sérialiser le JSON invaliderait le HMAC.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const config = app.get(ConfigService);

  // Sert les médias en local (en production, Apache sert directement le
  // dossier public o2switch — cette ligne ne fait alors rien de plus).
  app.useStaticAssets(config.getOrThrow<string>('media.storagePath'), { prefix: '/media' });

  app.setGlobalPrefix(config.getOrThrow<string>('apiPrefix'));
  app.enableShutdownHooks();

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());

  // CORS strict : l'API est consommée par l'application mobile (sans origine)
  // et par le web PHP pendant la migration. Aucune origine générique.
  app.enableCors({
    origin: config.getOrThrow<string[]>('corsOrigins'),
    credentials: false,
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Contrat OpenAPI généré depuis les DTO : jamais désynchronisé du code (§5.1).
  const openapi = new DocumentBuilder()
    .setTitle('API AllGo')
    .setDescription(
      'API de la plateforme de commerce social AllGo — Mahajanga, Madagascar.\n\n' +
        'Toutes les listes sont paginées par curseur. Toute création de commande ' +
        'ou de paiement exige un en-tête `Idempotency-Key`.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addServer('https://api.allgo.mg/v1', 'Production')
    .addServer('http://localhost:3000/v1', 'Développement local')
    .build();

  // `useGlobalPrefix` : sans lui, Swagger vit sur `/docs` au lieu de `/v1/docs`,
  // hors du seul chemin (`/v1/*`) qu'un déploiement partageant le domaine avec
  // un autre site (o2switch) peut faire passer à Passenger.
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openapi), {
    swaggerOptions: { persistAuthorization: true },
    useGlobalPrefix: true,
  });

  const port = config.getOrThrow<number>('port');
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
