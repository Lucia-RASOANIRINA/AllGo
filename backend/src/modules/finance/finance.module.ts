import { Module } from '@nestjs/common';

import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

/**
 * 100 % MySQL depuis la Phase 6 (`transactions`/`orders`/`invoices`/`refunds`/
 * `merchant_withdrawals`/`courier_withdrawals`) via `PrismaService`
 * (`@Global()`) — plus aucune dépendance Mongo, plus besoin d'importer
 * `CourierEarningsModule` pour partager le modèle de retrait livreur.
 */
@Module({
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
