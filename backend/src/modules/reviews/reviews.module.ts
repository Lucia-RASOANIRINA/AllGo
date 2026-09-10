import { Module } from '@nestjs/common';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

/** 100 % MySQL (`product_reviews`, Phase 5) — plus besoin d'`AuthModule` depuis la bascule d'identité (Phase 6). */
@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
