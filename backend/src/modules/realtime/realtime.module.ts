import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { EventsGateway } from './events.gateway';
import { Order, OrderSchema } from '../orders/schemas/order.schema';

@Global()
@Module({
  imports: [JwtModule.register({}), MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }])],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class RealtimeModule {}
