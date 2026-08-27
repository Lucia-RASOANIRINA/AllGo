import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { StockMovement, StockMovementSchema } from './schemas/stock-movement.schema';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

/** Stock et opérations de terrain (scan, mouvement unitaire, alertes) — lot **L5**. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
