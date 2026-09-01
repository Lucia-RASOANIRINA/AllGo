import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { StockMovement, StockMovementSchema } from '../stock/schemas/stock-movement.schema';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { Cart, CartSchema } from './schemas/cart.schema';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { Invoice, InvoiceSchema, Refund, RefundSchema } from './schemas/invoice.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Order, OrderSchema } from './schemas/order.schema';
import { Coupon, CouponSchema } from './schemas/coupon.schema';
import { Dispute, DisputeSchema } from './schemas/dispute.schema';
import { Promotion, PromotionSchema } from '../campaigns/schemas/promotion.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Cart.name, schema: CartSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: Product.name, schema: ProductSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: User.name, schema: UserSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: Promotion.name, schema: PromotionSchema },
      { name: Dispute.name, schema: DisputeSchema },
    ]),
  ],
  controllers: [OrdersController, CartController],
  providers: [OrdersService, CartService],
  // `MongooseModule` doit être réexporté, pas seulement importé : sans lui,
  // un module qui importe `OrdersModule` pour son `Order` (ex.
  // `CourierEarningsModule`) ne peut pas l'injecter — Nest limite la portée
  // d'un modèle enregistré via `forFeature` au module qui l'enregistre.
  exports: [OrdersService, MongooseModule],
})
export class OrdersModule {}
