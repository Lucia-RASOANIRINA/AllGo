import { Module } from '@nestjs/common';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { FinanceModule } from '../finance/finance.module';
import { MediaModule } from '../media/media.module';
import { PaymentsModule } from '../payments/payments.module';

/**
 * `Order`/`Cart`/`Coupon`/`Dispute`/`Invoice`/`Refund`/`Counter`/`Promotion`
 * ont tous migré vers MySQL (Phases 3-4) : `OrdersService`/`CartService`
 * ne dépendent plus de Mongoose ni du miroir boutique.
 */
@Module({
  imports: [FinanceModule, MediaModule, PaymentsModule],
  controllers: [OrdersController, CartController],
  providers: [OrdersService, CartService],
  exports: [OrdersService],
})
export class OrdersModule {}
