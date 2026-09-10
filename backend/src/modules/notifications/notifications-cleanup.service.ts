import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { NotificationsService } from './notifications.service';

/** Purge horaire des notifications expirées (§10.1) — remplace l'index TTL Mongo. */
@Injectable()
export class NotificationsCleanupService {
  private readonly logger = new Logger(NotificationsCleanupService.name);

  constructor(private readonly notifications: NotificationsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    const { deleted } = await this.notifications.purgeExpired();
    if (deleted > 0) this.logger.debug(`${deleted} notification(s) expirée(s) purgée(s).`);
  }
}
