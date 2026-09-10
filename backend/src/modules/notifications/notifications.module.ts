import { Module } from '@nestjs/common';
import { NotificationsCleanupService } from './notifications-cleanup.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/** 100 % MySQL depuis la Phase 6 — plus de dépendance au miroir `User`. */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsCleanupService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
