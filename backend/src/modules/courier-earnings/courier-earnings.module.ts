import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CourierEarningsController } from './courier-earnings.controller';
import { CourierEarningsService } from './courier-earnings.service';
import { CourierWithdrawal, CourierWithdrawalSchema } from './schemas/withdrawal.schema';
import { CourierBonus, CourierBonusSchema } from './schemas/bonus.schema';

/**
 * `Order` a migré vers MySQL (Phase 3) : les agrégats de revenus livreur
 * passent désormais par `PrismaService` (`@Global()`), plus besoin
 * d'importer `OrdersModule`. `CourierWithdrawal`/`CourierBonus` restent
 * sur Mongo (pas de table réelle équivalente).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CourierWithdrawal.name, schema: CourierWithdrawalSchema },
      { name: CourierBonus.name, schema: CourierBonusSchema },
    ]),
  ],
  controllers: [CourierEarningsController],
  providers: [CourierEarningsService],
  exports: [CourierEarningsService],
})
export class CourierEarningsModule {}
