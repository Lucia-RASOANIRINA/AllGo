import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CourierWithdrawal, CourierWithdrawalSchema } from '../courier-earnings/schemas/withdrawal.schema';
import { Invoice, InvoiceSchema, Refund, RefundSchema } from '../orders/schemas/invoice.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { MerchantWithdrawal, MerchantWithdrawalSchema } from './schemas/merchant-withdrawal.schema';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';

/**
 * Réenregistre `Order`/`Invoice`/`Refund`/`CourierWithdrawal` plutôt que
 * d'importer `OrdersModule`/`CourierEarningsModule` — même motif que
 * `ModerationModule` (§29) : `OrdersModule` importe CE module pour
 * comptabiliser le revenu de plateforme à la livraison, ce qui rendrait
 * l'import inverse circulaire.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: MerchantWithdrawal.name, schema: MerchantWithdrawalSchema },
      { name: CourierWithdrawal.name, schema: CourierWithdrawalSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
  ],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
