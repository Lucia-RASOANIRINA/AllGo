import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: User.name, schema: UserSchema },
    { name: Shop.name, schema: ShopSchema },
    { name: Product.name, schema: ProductSchema },
    { name: Order.name, schema: OrderSchema },
  ])],
  controllers: [AdministrationController],
  providers: [AdministrationService],
})
export class AdministrationModule {}
