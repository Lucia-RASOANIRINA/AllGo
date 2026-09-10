import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationModule } from '../moderation/moderation.module';

/**
 * Messagerie temps réel — `conversations`/`messages`/`message_attachments`
 * sont des tables MySQL réelles depuis la Phase 4. Plus besoin d'`AuthModule`
 * depuis la bascule d'identité (Phase 6, `id` miroir = entier MySQL).
 */
@Module({
  imports: [NotificationsModule, ModerationModule],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
