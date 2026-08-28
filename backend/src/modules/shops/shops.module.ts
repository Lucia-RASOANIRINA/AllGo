import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { Review, ReviewSchema } from './schemas/review.schema';
import { Shop, ShopSchema } from './schemas/shop.schema';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shop.name, schema: ShopSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
    UsersModule,
  ],
  controllers: [ShopsController],
  providers: [ShopsService],
  exports: [ShopsService, MongooseModule],
})
export class ShopsModule {}
