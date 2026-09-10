import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { raw } from 'express';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule implements NestModule {
  /**
   * Corps brut (octets d'image/vidéo) scopé à cette seule route — le parseur
   * JSON global de Nest ignore les corps non-JSON de toute façon, mais sans ce
   * middleware `req.body` resterait vide pour un `Content-Type: image/jpeg`.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(raw({ type: () => true, limit: '55mb' }))
      .forRoutes({ path: 'media/upload/:token', method: RequestMethod.PUT });
  }
}
