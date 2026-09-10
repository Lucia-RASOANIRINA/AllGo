import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { MediaModule } from '../media/media.module';

/** `Promotion` a migré vers MySQL (Phase 4) — plus besoin de Mongoose ni du miroir boutique ici. */
@Module({
  imports: [MediaModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
