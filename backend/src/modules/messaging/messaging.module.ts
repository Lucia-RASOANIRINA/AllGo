import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Conversation,
  ConversationSchema,
  Message,
  MessageSchema,
} from './schemas/conversation.schema';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';

/** Messagerie temps réel — lot **L4**. Schémas et index déclarés dès L0. */
@Module({
  imports: [
    NotificationsModule,
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Shop.name, schema: ShopSchema },
    ]),
  ],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MongooseModule, MessagingService],
})
export class MessagingModule {}
