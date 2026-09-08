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

  list(userId: string, archived = false): Promise<unknown[]> {
    const id = new Types.ObjectId(userId);
    return this.conversations
      .find({
        'participants.userId': id,
        archivedBy: archived ? id : { $ne: id },
      })
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
    // Un message supprimé « pour moi » ne doit pas réapparaître dans ma
    // propre liste — l'autre participant, qui n'a rien supprimé, le voit
    // toujours : ce filtre est donc par lecteur, jamais un `deletedAt` partagé.
    return this.messages
      .find({ conversationId, deletedFor: { $ne: new Types.ObjectId(userId) } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();
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

  /**
   * Marque tout comme lu d'un coup, pas message par message : un accusé de
   * lecture par ligne exigerait un aller-retour réseau par message affiché,
   * pour un gain imperceptible côté utilisateur.
   */
  async markRead(conversationId: string, userId: string): Promise<{ read: true }> {
    const id = new Types.ObjectId(userId);
    await this.member(conversationId, userId);
    await Promise.all([
      this.messages.updateMany(
        { conversationId: new Types.ObjectId(conversationId), readBy: { $ne: id } },
        { $addToSet: { readBy: id } },
      ),
      this.conversations.updateOne(
        { _id: conversationId },
        { $set: { [`unread.${userId}`]: 0 } },
      ),
    ]);
    return { read: true };
  }

  async setArchived(conversationId: string, userId: string, archived: boolean): Promise<{ archived: boolean }> {
    const id = new Types.ObjectId(userId);
    await this.member(conversationId, userId);
    await this.conversations.updateOne(
      { _id: conversationId },
      archived ? { $addToSet: { archivedBy: id } } : { $pull: { archivedBy: id } },
    );
    return { archived };
  }

  /** Message d'une conversation dont je suis membre — sans restriction sur
   * l'auteur : supprimer « pour moi » s'applique à n'importe quel message,
   * envoyé ou reçu, comme sur les messageries grand public. */
  private async messageIn(conversationId: string, messageId: string, userId: string): Promise<MessageDocument> {
    await this.member(conversationId, userId);
    const message = await this.messages.findOne({
      _id: messageId,
      conversationId: new Types.ObjectId(conversationId),
    });
    if (!message) throw AppError.notFound('Message');
    return message;
  }

  /** Idem, réservé à l'auteur — seule l'édition l'exige, jamais la
   * suppression « pour moi ». */
  private async ownMessage(conversationId: string, messageId: string, userId: string): Promise<MessageDocument> {
    const message = await this.messageIn(conversationId, messageId, userId);
    if (String(message.senderId) !== userId) {
      throw new AppError('FORBIDDEN', 'Seul l’auteur peut modifier ce message.', 403);
    }
    if (message.deletedFor.some((id) => String(id) === userId)) {
      throw new AppError('MESSAGE_DELETED', 'Ce message a été supprimé.', 409);
    }
    return message;
  }

  async editMessage(
    conversationId: string,
    messageId: string,
    userId: string,
    content: string,
  ): Promise<unknown> {
    if (!content.trim()) throw new AppError('MESSAGE_EMPTY', 'Le message ne peut pas être vide.', 400);
    const message = await this.ownMessage(conversationId, messageId, userId);
    message.content = content.trim();
    message.editedAt = new Date();
    await message.save();

    const conversation = await this.conversations.findById(conversationId);
    // Le dernier message affiché dans la liste des conversations est un
    // instantané : s'il s'agit de celui qu'on vient d'éditer, il doit
    // refléter le nouveau texte, sinon la liste ment sur ce qui a été dit.
    if (conversation?.lastMessage && String(conversation.lastMessage.senderId) === String(message.senderId)) {
      const last = await this.messages.findOne({ conversationId: message.conversationId }).sort({ createdAt: -1 });
      if (last && String(last._id) === messageId) {
        conversation.lastMessage.content = message.content;
        await conversation.save();
      }
    }

    for (const participant of conversation?.participants ?? []) {
      const participantId = String(participant.userId);
      if (participantId !== userId) {
        this.realtime.emitToUser(participantId, RealtimeEvent.MessageNew, {
          conversationId,
          message: message.toJSON(),
          edited: true,
        });
      }
    }
    return message.toJSON();
  }

  /**
   * Suppression « pour moi » uniquement — le contenu et les pièces jointes
   * restent intacts pour l'autre participant, qui ne voit donc passer aucun
   * événement temps réel : rien n'a changé de son côté.
   */
  async deleteMessage(conversationId: string, messageId: string, userId: string): Promise<{ deleted: true }> {
    const message = await this.messageIn(conversationId, messageId, userId);
    await this.messages.updateOne(
      { _id: message._id },
      { $addToSet: { deletedFor: new Types.ObjectId(userId) } },
    );
    return { deleted: true };
  }
}
