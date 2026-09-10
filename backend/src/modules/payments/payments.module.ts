import { Module } from '@nestjs/common';

import { PAYMENT_PROVIDERS, type PaymentProvider } from './payment-provider.interface';
import { AirtelMoneyProvider } from './providers/airtel-money.provider';
import { MvolaProvider } from './providers/mvola.provider';
import { OrangeMoneyProvider } from './providers/orange-money.provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Les implémentations Orange Money et Airtel Money seront ajoutées au lot L2,
 * sur le même contrat `PaymentProvider`. Le registre ci-dessous est le seul
 * endroit à modifier pour en brancher une nouvelle.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    MvolaProvider,
    OrangeMoneyProvider,
    AirtelMoneyProvider,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [MvolaProvider, OrangeMoneyProvider, AirtelMoneyProvider],
      useFactory: (
        mvola: MvolaProvider,
        orangeMoney: OrangeMoneyProvider,
        airtelMoney: AirtelMoneyProvider,
      ): Map<string, PaymentProvider> =>
        new Map<string, PaymentProvider>([
          [mvola.name, mvola],
          [orangeMoney.name, orangeMoney],
          [airtelMoney.name, airtelMoney],
        ]),
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
