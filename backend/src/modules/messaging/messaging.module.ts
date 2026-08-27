import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Conversation,
  ConversationSchema,
  Message,
  MessageSchema,
} from './schemas/conversation.schema';

/** Messagerie temps réel — lot **L4**. Schémas et index déclarés dès L0. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class MessagingModule {}
