import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { Category, CategorySchema } from '../catalog/schemas/category.schema';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Shop.name, schema: ShopSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
