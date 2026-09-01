import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersModule } from '../orders/orders.module';
import { CourierEarningsController } from './courier-earnings.controller';
import { CourierEarningsService } from './courier-earnings.service';
import { CourierWithdrawal, CourierWithdrawalSchema } from './schemas/withdrawal.schema';
import { CourierBonus, CourierBonusSchema } from './schemas/bonus.schema';

@Module({
  imports: [
    OrdersModule,
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
