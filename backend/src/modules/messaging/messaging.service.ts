import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { EventsGateway, RealtimeEvent } from '../realtime/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { Role } from '../../common/rbac/roles';
import { ModerationService } from '../moderation/moderation.service';
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
    private readonly realtime: EventsGateway,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationService,
  ) {}

  list(userId: string): Promise<unknown[]> {
    return this.conversations
      .find({ 'participants.userId': new Types.ObjectId(userId) })
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();
  }

  async create(user: AuthenticatedUser, target: { participantId?: string; shopId?: string }): Promise<unknown> {
    const other = target.shopId
      ? await this.resolveShopParticipant(target.shopId)
      : target.participantId
        ? { userId: target.participantId, name: target.participantId, shopId: undefined as string | undefined, avatar: undefined as string | undefined }
        : null;
    if (!other) throw new AppError('INVALID_PARTICIPANT', 'Une conversation nécessite une boutique ou un autre participant.', 400);
    if (other.userId === user.id) {
      throw new AppError('INVALID_PARTICIPANT', 'Une conversation nécessite un autre participant.', 400);
    }

    const ids = [new Types.ObjectId(user.id), new Types.ObjectId(other.userId)];
    const existing = await this.conversations.findOne({
      'participants.userId': { $all: ids },
      'participants': { $size: 2 },
    });
    if (existing) return existing.toJSON();

    const conversation = await this.conversations.create({
      participants: [
        { userId: ids[0], name: user.phone },
        {
          userId: ids[1],
          name: other.name,
          avatar: other.avatar,
          shopId: other.shopId ? new Types.ObjectId(other.shopId) : undefined,
        },
      ],
      unread: { [user.id]: 0, [other.userId]: 0 },
    });
    return conversation.toJSON();
  }

  /**
   * Une conversation « avec une boutique » s'adresse en réalité à son
   * propriétaire (à défaut, le premier membre actif) : le modèle
   * `Conversation` ne connaît que des utilisateurs, jamais de boutique
   * directement — `participants[].shopId` n'est qu'une étiquette d'affichage.
   */
  private async resolveShopParticipant(
    shopId: string,
  ): Promise<{ userId: string; name: string; avatar?: string; shopId: string }> {
    const shop = await this.shops.findById(shopId).select('name logo team ownerId').lean();
    if (!shop) throw AppError.notFound('Boutique');
    const owner = shop.team.find((member) => member.role === Role.ShopOwner) ?? shop.team[0];
    const userId = owner ? String(owner.userId) : String(shop.ownerId);
    return { userId, name: shop.name, avatar: shop.logo, shopId: String(shop._id) };
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
    if (conversation.blockedBy.length > 0) {
      throw new AppError('CONVERSATION_BLOCKED', 'Cette conversation est bloquée.', 403);
    }
    // Blocage générique compte-à-compte (§29) — distinct du blocage de
    // conversation ci-dessus : ferme aussi les nouvelles conversations entre
    // les deux comptes, pas seulement celle-ci.
    const other = conversation.participants.find((participant) => String(participant.userId) !== user.id);
    if (other && (await this.moderation.isBlockedEitherWay(user.id, String(other.userId)))) {
      throw new AppError('CONVERSATION_BLOCKED', 'Cette conversation est bloquée.', 403);
    }
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

  /**
   * Bloquer ferme le CANAL dans les deux sens (`send` refuse dès qu'un
   * participant, quel qu'il soit, a bloqué) — un blocage à sens unique
   * laisserait l'autre partie continuer à écrire sans le savoir.
   */
  async block(conversationId: string, userId: string): Promise<{ blocked: true }> {
    const conversation = await this.member(conversationId, userId);
    await this.conversations.updateOne(
      { _id: conversation._id },
      { $addToSet: { blockedBy: new Types.ObjectId(userId) } },
    );
    return { blocked: true };
  }

  async unblock(conversationId: string, userId: string): Promise<{ blocked: false }> {
    const conversation = await this.member(conversationId, userId);
    await this.conversations.updateOne(
      { _id: conversation._id },
      { $pull: { blockedBy: new Types.ObjectId(userId) } },
    );
    return { blocked: false };
  }

  async report(conversationId: string, userId: string, reason?: string): Promise<{ reported: true }> {
    await this.member(conversationId, userId);
    await this.conversations.updateOne(
      { _id: conversationId },
      { $set: { reported: true, reportReason: reason } },
    );
    return { reported: true };
  }
}
