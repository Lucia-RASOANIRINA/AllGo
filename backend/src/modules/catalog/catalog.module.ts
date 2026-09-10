import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { MediaModule } from '../media/media.module';

/**
 * 100 % MySQL depuis la Phase 2 (`products`/`categories`) — l'enregistrement
 * Mongoose `Product`/`Category`/`Shop` restait présent sans plus aucun
 * consommateur (`@InjectModel` jamais appelé côté service depuis lors),
 * même régression que celle trouvée et corrigée dans `shops.module.ts`.
 */
@Module({
  imports: [MediaModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
