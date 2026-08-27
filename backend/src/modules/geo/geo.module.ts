import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Shop.name, schema: ShopSchema }])],
  controllers: [GeoController],
  providers: [GeoService],
})
export class GeoModule {}
