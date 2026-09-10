import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { MediaModule } from '../media/media.module';

/**
 * Stock et opérations de terrain (scan, mouvement unitaire, alertes) — lot
 * **L5**. 100 % MySQL depuis la Phase 6 (`stock_movements`) — `ShopsModule`
 * n'est plus nécessaire, `StockMovement` était son dernier consommateur.
 */
@Module({
  imports: [MediaModule],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
