import { Module } from '@nestjs/common';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { MediaModule } from '../media/media.module';

/**
 * 100 % MySQL depuis la Phase 6 — `StockMovement` (dernier consommateur du
 * miroir Mongo `Shop`) a migré vers `stock_movements` ; plus aucune
 * dépendance Mongo dans ce module.
 */
@Module({
  imports: [MediaModule],
  controllers: [ShopsController],
  providers: [ShopsService],
  exports: [ShopsService],
})
export class ShopsModule {}
