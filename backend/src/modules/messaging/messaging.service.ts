import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { EventsGateway, RealtimeEvent } from '../realtime/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import {
  Conversation,
  type ConversationDocument,
  Message,
  type MessageDocument,
} from './schemas/conversation.schema';

@Injectable()
export class MessagingService {
  constructor(
    @InjectModel(Conversation.name) private readonly conversations: Model<ConversationDocument>,
    @InjectModel(Message.name) private readonly messages: Model<MessageDocument>,
    private readonly realtime: EventsGateway,
    private readonly notifications: NotificationsService,
  ) {}

  list(userId: string): Promise<unknown[]> {
    return this.conversations
      .find({ 'participants.userId': new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
  }

  async create(user: AuthenticatedUser, participantId: string): Promise<unknown> {
    if (participantId === user.id) throw new AppError('INVALID_PARTICIPANT', 'Une conversation nécessite un autre participant.', 400);
    const ids = [new Types.ObjectId(user.id), new Types.ObjectId(participantId)];
    const existing = await this.conversations.findOne({
      'participants.userId': { $all: ids },
      'participants': { $size: 2 },
    });
    if (existing) return existing.toJSON();
    const conversation = await this.conversations.create({
      participants: [
        { userId: ids[0], name: user.phone },
        { userId: ids[1], name: participantId },
      ],
      unread: { [user.id]: 0, [participantId]: 0 },
    });
    return conversation.toJSON();
  }

  private async member(conversationId: string, userId: string): Promise<ConversationDocument> {
    const conversation = await this.conversations.findOne({
      _id: conversationId,
      'participants.userId': new Types.ObjectId(userId),
    });
    if (!conversation) throw AppError.notFound('Conversation');
    return conversation;
  }

  async listMessages(conversationId: string, userId: string, limit: number): Promise<unknown[]> {
    await this.member(conversationId, userId);
    return this.messages.find({ conversationId }).sort({ createdAt: 1 }).limit(limit).lean();
  }

  async send(
    conversationId: string,
    user: AuthenticatedUser,
    content: string,
    attachments: Array<{ url: string; type: string; name?: string }> = [],
  ): Promise<unknown> {
    const conversation = await this.member(conversationId, user.id);
    if (!content.trim()) throw new AppError('MESSAGE_EMPTY', 'Le message ne peut pas être vide.', 400);
    const message = await this.messages.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(user.id),
      content: content.trim(),
      attachments,
      readBy: [new Types.ObjectId(user.id)],
    });
    conversation.lastMessage = {
      content: content.trim(),
      senderId: new Types.ObjectId(user.id),
      sentAt: new Date(),
    };
    for (const participant of conversation.participants) {
      const key = String(participant.userId);
      if (key !== user.id) conversation.unread.set(key, (conversation.unread.get(key) ?? 0) + 1);
    }
    await conversation.save();
    for (const participant of conversation.participants) {
      const participantId = String(participant.userId);
      if (participantId !== user.id) {
        this.realtime.emitToUser(participantId, RealtimeEvent.MessageNew, {
          conversationId,
          message: message.toJSON(),
        });
        await this.notifications.create({
          userId: participantId,
          type: 'message.received',
          title: `Nouveau message de ${user.phone}`,
          body: content.trim(),
          data: { screen: 'conversation', conversationId },
        });
      }
    }
    return message.toJSON();
  }
}
