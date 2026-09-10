import { Module } from '@nestjs/common';
import { CourierEarningsController } from './courier-earnings.controller';
import { CourierEarningsService } from './courier-earnings.service';

/**
 * 100 % MySQL depuis la Phase 6 (`orders`, `courier_withdrawals`,
 * `courier_bonuses`) via `PrismaService` (`@Global()`) — plus aucune
 * dépendance Mongo.
 */
@Module({
  controllers: [CourierEarningsController],
  providers: [CourierEarningsService],
  exports: [CourierEarningsService],
})
export class CourierEarningsModule {}
