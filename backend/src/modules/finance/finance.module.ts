import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CourierWithdrawal, CourierWithdrawalSchema } from '../courier-earnings/schemas/withdrawal.schema';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { MerchantWithdrawal, MerchantWithdrawalSchema } from './schemas/merchant-withdrawal.schema';

/**
 * `Transaction`/`Order`/`Invoice`/`Refund` ont migré vers MySQL (Phase 3) :
 * `FinanceService` les lit désormais via `PrismaService` (`@Global()`).
 * `MerchantWithdrawal`/`CourierWithdrawal` restent sur Mongo (pas de table
 * réelle équivalente) — réenregistrés ici plutôt qu'en important
 * `CourierEarningsModule`, pour éviter une dépendance circulaire
 * (`OrdersModule` importe déjà ce module pour comptabiliser le revenu de
 * plateforme à la livraison).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MerchantWithdrawal.name, schema: MerchantWithdrawalSchema },
      { name: CourierWithdrawal.name, schema: CourierWithdrawalSchema },
    ]),
  ],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
