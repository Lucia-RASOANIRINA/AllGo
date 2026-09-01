import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { Counter, CounterSchema } from '../orders/schemas/counter.schema';
import { Invoice, InvoiceSchema } from '../orders/schemas/invoice.schema';
import { PAYMENT_PROVIDERS } from './payment-provider.interface';
import { MvolaProvider } from './providers/mvola.provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Les implémentations Orange Money et Airtel Money seront ajoutées au lot L2,
 * sur le même contrat `PaymentProvider`. Le registre ci-dessous est le seul
 * endroit à modifier pour en brancher une nouvelle.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    MvolaProvider,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [MvolaProvider],
      useFactory: (mvola: MvolaProvider) => new Map([[mvola.name, mvola]]),
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
