import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { GeoModule } from '../geo/geo.module';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { StockMovement, StockMovementSchema } from '../stock/schemas/stock-movement.schema';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { Cart, CartSchema } from './schemas/cart.schema';
import { Counter, CounterSchema } from './schemas/counter.schema';
import { Coupon, CouponSchema } from './schemas/coupon.schema';
import { Invoice, InvoiceSchema, Refund, RefundSchema } from './schemas/invoice.schema';
import { Order, OrderSchema } from './schemas/order.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Cart.name, schema: CartSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Shop.name, schema: ShopSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
    GeoModule,
  ],
  controllers: [OrdersController, CartController],
  providers: [OrdersService, CartService],
  exports: [OrdersService],
})
export class OrdersModule {}
