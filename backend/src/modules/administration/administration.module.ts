import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { CourierEarningsModule } from '../courier-earnings/courier-earnings.module';
import { FinanceModule } from '../finance/finance.module';
import { Review, ReviewSchema } from '../reviews/schemas/review.schema';
import { Post, PostSchema } from '../social/schemas/post.schema';
import { Report, ReportSchema } from '../moderation/schemas/report.schema';
import { AdminLogsModule } from '../admin-logs/admin-logs.module';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';

/**
 * `Order`/`Dispute` ont migré vers MySQL (Phase 3) : `ordersList`/
 * `disputesList`/`resolveDispute` passent désormais par `PrismaService`
 * (`@Global()`), plus besoin de les enregistrer ici.
 */
@Module({
  imports: [
    CourierEarningsModule,
    FinanceModule,
    AdminLogsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Review.name, schema: ReviewSchema },
      { name: Post.name, schema: PostSchema },
      { name: Report.name, schema: ReportSchema },
    ]),
  ],
  controllers: [AdministrationController],
  providers: [AdministrationService],
})
export class AdministrationModule {}
