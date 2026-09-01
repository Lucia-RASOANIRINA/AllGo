import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Dispute, DisputeSchema } from '../orders/schemas/dispute.schema';
import { CourierEarningsModule } from '../courier-earnings/courier-earnings.module';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';

@Module({
  imports: [
    CourierEarningsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Shop.name, schema: ShopSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Dispute.name, schema: DisputeSchema },
    ]),
  ],
  controllers: [AdministrationController],
  providers: [AdministrationService],
})
export class AdministrationModule {}
