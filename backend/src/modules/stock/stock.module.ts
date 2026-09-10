import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StockMovement, StockMovementSchema } from './schemas/stock-movement.schema';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { MediaModule } from '../media/media.module';
import { ShopsModule } from '../shops/shops.module';

/** Stock et opérations de terrain (scan, mouvement unitaire, alertes) — lot **L5**. */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: StockMovement.name, schema: StockMovementSchema }]),
    MediaModule,
    ShopsModule,
  ],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
