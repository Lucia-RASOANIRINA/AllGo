import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { Promotion, PromotionSchema } from './schemas/promotion.schema';
@Module({ imports: [MongooseModule.forFeature([{ name: Promotion.name, schema: PromotionSchema }])], controllers: [CampaignsController], providers: [CampaignsService] })
export class CampaignsModule {}
