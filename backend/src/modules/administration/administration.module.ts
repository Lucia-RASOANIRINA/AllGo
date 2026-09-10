import { Module } from '@nestjs/common';
import { CourierEarningsModule } from '../courier-earnings/courier-earnings.module';
import { FinanceModule } from '../finance/finance.module';
import { AdminLogsModule } from '../admin-logs/admin-logs.module';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';

/**
 * 100 % Prisma (`@Global()`) — plus aucun schéma Mongoose à enregistrer ici,
 * ni besoin d'`AuthModule` depuis la bascule d'identité (Phase 6, `id` miroir
 * = entier MySQL).
 */
@Module({
  imports: [CourierEarningsModule, FinanceModule, AdminLogsModule],
  controllers: [AdministrationController],
  providers: [AdministrationService],
})
export class AdministrationModule {}
