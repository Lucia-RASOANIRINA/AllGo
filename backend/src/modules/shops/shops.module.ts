import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Shop, ShopSchema } from './schemas/shop.schema';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { Post, PostSchema } from '../social/schemas/post.schema';
import { Follow, FollowSchema } from '../social/schemas/interactions.schema';
import { Promotion, PromotionSchema } from '../campaigns/schemas/promotion.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Shop.name, schema: ShopSchema }, { name: Order.name, schema: OrderSchema },
    { name: Product.name, schema: ProductSchema }, { name: Post.name, schema: PostSchema },
    { name: Follow.name, schema: FollowSchema }, { name: Promotion.name, schema: PromotionSchema },
    { name: User.name, schema: UserSchema },
  ])],
  controllers: [ShopsController],
  providers: [ShopsService],
  exports: [ShopsService, MongooseModule],
})
export class ShopsModule {}
