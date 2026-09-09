import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import configuration from './config/configuration';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { RedisModule } from './infrastructure/redis/redis.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ShopsModule } from './modules/shops/shops.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { GeoModule } from './modules/geo/geo.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SocialModule } from './modules/social/social.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { StockModule } from './modules/stock/stock.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MediaModule } from './modules/media/media.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SyncModule } from './modules/sync/sync.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { HealthModule } from './modules/health/health.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { CourierEarningsModule } from './modules/courier-earnings/courier-earnings.module';
import { AdministrationModule } from './modules/administration/administration.module';
import { SearchModule } from './modules/search/search.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { FinanceModule } from './modules/finance/finance.module';
import { KycModule } from './modules/kyc/kyc.module';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: process.env.LOG_LEVEL ?? 'info',
          // `RequestIdMiddleware` a déjà posé `req.id` : on le réutilise pour
          // que le journal HTTP porte le même identifiant que la réponse.
          genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
          transport: config.get('env') === 'development' ? { target: 'pino-pretty' } : undefined,
          // Ne jamais journaliser un secret, un mot de passe ou un jeton.
          redact: [
            'req.headers.authorization',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.refreshToken',
          ],
        },
      }),
    }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('mongoUri'),
        // Les écritures ne sont confirmées qu'une fois répliquées sur la
        // majorité du replica set : une bascule de primaire ne peut pas perdre
        // une commande déjà confirmée au client.
        writeConcern: { w: 'majority' },
        // `primary` est OBLIGATOIRE, pas une préférence de confort : une
        // transaction multi-documents refuse toute autre valeur
        // (« Read preference in a transaction must be primary »). Avec
        // `primaryPreferred`, la création de commande échoue systématiquement.
        readPreference: 'primary',
        retryWrites: true,
      }),
    }),

    // Limitation de débit — §7.1 : 100 req/min par défaut, 10 req/min sur
    // l'authentification (surcharge locale dans AuthController).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),

    ScheduleModule.forRoot(),
    RedisModule,
    PrismaModule,

    AuthModule,
    UsersModule,
    ShopsModule,
    CatalogModule,
    GeoModule,
    OrdersModule,
    SocialModule,
    MessagingModule,
    StockModule,
    NotificationsModule,
    MediaModule,
    PaymentsModule,
    SyncModule,
    RealtimeModule,
    HealthModule,
    ReviewsModule,
    CampaignsModule,
    CourierEarningsModule,
    AdministrationModule,
    SearchModule,
    ModerationModule,
    FinanceModule,
    KycModule,
    SettingsModule,
  ],
  providers: [
    // Ordre significatif : authentification, puis permissions, puis débit.
    // Sécurité par défaut — toute route est refusée sauf déclaration explicite.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
