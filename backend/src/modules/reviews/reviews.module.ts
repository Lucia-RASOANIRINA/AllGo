import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { Review, ReviewSchema } from './schemas/review.schema';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Review.name, schema: ReviewSchema }, { name: Order.name, schema: OrderSchema },
    { name: Product.name, schema: ProductSchema }, { name: Shop.name, schema: ShopSchema },
  ])],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
