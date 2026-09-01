import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shop.name, schema: ShopSchema },
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  controllers: [GeoController],
  providers: [GeoService],
})
export class GeoModule {}
