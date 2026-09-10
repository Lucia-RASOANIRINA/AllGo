import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { StoriesService } from './stories.service';

/** Purge horaire des stories expirées depuis plus de 7 jours (§ rétention). */
@Injectable()
export class StoriesCleanupService {
  private readonly logger = new Logger(StoriesCleanupService.name);

  constructor(private readonly stories: StoriesService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    const { deleted } = await this.stories.purgeExpired();
    if (deleted > 0) this.logger.debug(`${deleted} story(ies) expirée(s) purgée(s).`);
  }
}
