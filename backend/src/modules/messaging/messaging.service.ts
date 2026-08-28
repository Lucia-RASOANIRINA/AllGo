import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { EventsGateway, RealtimeEvent } from '../realtime/events.gateway';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
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
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    private readonly gateway: EventsGateway,
  ) {}

  /**
   * Trouve ou crée la conversation entre un client et une boutique.
   *
   * Une conversation par paire (client, boutique) : rouvrir la messagerie
   * depuis la fiche boutique doit reprendre le fil existant, pas en ouvrir un
   * nouveau à chaque fois.
   */
  async getOrCreateWithShop(
    clientId: string,
    clientName: string,
    shopId: string,
  ): Promise<unknown> {
    // `participants` est `type: [Object]` (portée volontairement libre) :
    // Mongoose ne connaît pas le sous-schéma et NE convertit PAS les valeurs
    // de la requête en `ObjectId` sur ce chemin — comparer à des chaînes
    // échouerait silencieusement (aucune erreur, juste aucun résultat).
    const existing = await this.conversations
      .findOne({
        'participants.userId': new Types.ObjectId(clientId),
        'participants.shopId': new Types.ObjectId(shopId),
      })
      .lean();
    if (existing) return existing;

    const shop = await this.shops.findById(shopId).select('name logo ownerId').lean();
    if (!shop) throw AppError.notFound('Boutique');

    const conversation = await this.conversations.create({
      participants: [
        { userId: new Types.ObjectId(clientId), name: clientName },
        { userId: shop.ownerId, name: shop.name, avatar: shop.logo, shopId: shop._id },
      ],
      unread: {},
    });
    return conversation.toJSON();
  }

  /** Mes conversations, les plus récemment actives en premier. */
  async listMine(userId: string): Promise<unknown[]> {
    return this.conversations
      .find({ 'participants.userId': new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .lean();
  }

  async listMessages(
    conversationId: string,
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<unknown>> {
    await this.assertParticipant(conversationId, userId);

    const filter: Record<string, unknown> = { conversationId: new Types.ObjectId(conversationId) };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const docs = await this.messages
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;
    const last = items[items.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: String(last._id) })
          : null,
    };
  }

  async sendMessage(conversationId: string, senderId: string, content: string): Promise<unknown> {
    const conversation = await this.assertParticipant(conversationId, senderId);

    const message = await this.messages.create({
      conversationId: new Types.ObjectId(conversationId),
      senderId: new Types.ObjectId(senderId),
      content,
    });

    await this.conversations.updateOne(
      { _id: conversationId },
      { $set: { lastMessage: { content, senderId, sentAt: message.createdAt } } },
    );

    const payload = message.toJSON();
    for (const participant of conversation.participants as Array<{
      userId: Types.ObjectId;
      shopId?: Types.ObjectId;
    }>) {
      if (String(participant.userId) === senderId) continue;
      this.gateway.emitToUser(String(participant.userId), RealtimeEvent.MessageNew, payload);
      if (participant.shopId) {
        this.gateway.emitToShop(String(participant.shopId), RealtimeEvent.MessageNew, payload);
      }
    }

    return payload;
  }

  /** Portes closes : un participant ne peut lire/écrire que ses propres conversations. */
  private async assertParticipant(conversationId: string, userId: string) {
    const conversation = await this.conversations.findOne({
      _id: conversationId,
      'participants.userId': new Types.ObjectId(userId),
    });
    if (!conversation) throw AppError.notFound('Conversation');
    return conversation;
  }
}
