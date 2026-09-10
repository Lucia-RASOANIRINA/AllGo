import { Module } from '@nestjs/common';

import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

/**
 * `Report`/`Sanction`/`BannedWord` (Phase 5) et `UserBlock` (Phase 4) ont
 * tous migré vers MySQL : `ModerationService` ne dépend plus que de
 * `PrismaService` (`@Global()`) — plus besoin d'`AuthModule` depuis la
 * bascule d'identité (Phase 6).
 */
@Module({
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
