import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ModerationModule } from '../moderation/moderation.module';
import { AuthModule } from '../auth/auth.module';

/**
 * Messagerie temps réel — `conversations`/`messages`/`message_attachments`
 * sont des tables MySQL réelles depuis la Phase 4, plus de schéma Mongoose à
 * enregistrer ici. `AuthModule` fournit `resolveMirrorId()`/`resolveMysqlId()`.
 */
@Module({
  imports: [NotificationsModule, ModerationModule, AuthModule],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
