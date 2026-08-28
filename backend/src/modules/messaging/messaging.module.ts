import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { UsersModule } from '../users/users.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import {
  Conversation,
  ConversationSchema,
  Message,
  MessageSchema,
} from './schemas/conversation.schema';

/**
 * Messagerie temps réel — lot **L4**. Schémas et index déclarés dès L0.
 *
 * `EventsGateway` n'est pas importé ici : `RealtimeModule` est `@Global()`
 * (voir `realtime.module.ts`), son fournisseur est déjà disponible partout.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Shop.name, schema: ShopSchema },
    ]),
    UsersModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MongooseModule],
})
export class MessagingModule {}
