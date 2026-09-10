import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { EventsGateway, RealtimeEvent } from '../realtime/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ModerationService } from '../moderation/moderation.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

const CONVERSATION_INCLUDE = {
  users_conversations_user_one_idTousers: { select: { id: true, firstname: true, lastname: true, avatar: true } },
  users_conversations_user_two_idTousers: { select: { id: true, firstname: true, lastname: true, avatar: true } },
  shops: { select: { id: true, user_id: true, name: true, logo: true } },
} satisfies Prisma.conversationsInclude;

type ConversationRow = Prisma.conversationsGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

/**
 * Messagerie — `conversations`/`messages`/`message_attachments` sont des
 * tables réelles depuis la Phase 4. Le modèle réel est STRICTEMENT 1:1
 * (`user_one_id`/`user_two_id`) : plus de tableau `participants[]`, plus de
 * `unread`/`blockedBy`/`archivedBy` embarqués — reconstruits ici à la lecture
 * depuis les colonnes plates. `Participant.userId`/`Message.senderId`
 * restent exposés au format miroir Mongo (même motif que `SocialService` :
 * le mobile compare ces champs à `/me.id` et à `Conversation.blockedBy`).
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly realtime: EventsGateway,
    private readonly notifications: NotificationsService,
    private readonly moderation: ModerationService,
  ) {}

  async list(userMysqlId: number, archived = false): Promise<unknown[]> {
    const rows = await this.prisma.conversations.findMany({
      where: {
        OR: [
          {
            user_one_id: userMysqlId,
            archived_by_user_one_at: archived ? { not: null } : null,
          },
          {
            user_two_id: userMysqlId,
            archived_by_user_two_at: archived ? { not: null } : null,
          },
        ],
      },
      include: CONVERSATION_INCLUDE,
      orderBy: { id: 'desc' },
      take: 50,
    });
    return Promise.all(rows.map((row) => this.toJson(row)));
  }

  async create(user: AuthenticatedUser, target: { participantId?: string; shopId?: string }): Promise<unknown> {
    let otherMysqlId: number;
    let shopId: number | undefined;

    if (target.shopId) {
      const shop = await this.prisma.shops.findUnique({ where: { id: Number(target.shopId) } });
      if (!shop) throw AppError.notFound('Boutique');
      otherMysqlId = shop.user_id;
      shopId = shop.id;
    } else if (target.participantId) {
      const resolved = await this.auth.resolveMysqlId(target.participantId);
      if (!resolved) throw AppError.notFound('Utilisateur');
      otherMysqlId = resolved;
    } else {
      throw new AppError('INVALID_PARTICIPANT', 'Une conversation nécessite une boutique ou un autre participant.', 400);
    }

    if (otherMysqlId === user.mysqlId) {
      throw new AppError('INVALID_PARTICIPANT', 'Une conversation nécessite un autre participant.', 400);
    }

    const [userOneId, userTwoId] = [user.mysqlId, otherMysqlId].sort((a, b) => a - b);
    const row = await this.prisma.conversations.upsert({
      where: { user_one_id_user_two_id: { user_one_id: userOneId, user_two_id: userTwoId } },
      create: { user_one_id: userOneId, user_two_id: userTwoId, shop_id: shopId },
      update: {},
      include: CONVERSATION_INCLUDE,
    });
    return this.toJson(row);
  }

  /** Vérifie l'appartenance et renvoie la ligne — 404 sinon, jamais un 403 qui confirmerait l'existence de la conversation à un tiers. */
  private async member(conversationId: string, userMysqlId: number): Promise<ConversationRow> {
    const row = await this.prisma.conversations.findFirst({
      where: { id: Number(conversationId), OR: [{ user_one_id: userMysqlId }, { user_two_id: userMysqlId }] },
      include: CONVERSATION_INCLUDE,
    });
    if (!row) throw AppError.notFound('Conversation');
    return row;
  }

  private otherMysqlId(row: { user_one_id: number; user_two_id: number }, viewerMysqlId: number): number {
    return row.user_one_id === viewerMysqlId ? row.user_two_id : row.user_one_id;
  }

  /**
   * Un message supprimé « pour moi » ne doit pas réapparaître dans ma propre
   * liste — l'autre participant, qui n'a rien supprimé, le voit toujours :
   * ce filtre est donc par lecteur (expéditeur/destinataire), jamais une
   * colonne partagée.
   */
  async listMessages(conversationId: string, userMysqlId: number, limit: number): Promise<unknown[]> {
    await this.member(conversationId, userMysqlId);
    const rows = await this.prisma.messages.findMany({
      where: {
        conversation_id: Number(conversationId),
        OR: [
          { sender_id: userMysqlId, deleted_by_sender_at: null },
          { sender_id: { not: userMysqlId }, deleted_by_recipient_at: null },
        ],
      },
      include: { message_attachments: true },
      orderBy: { created_at: 'asc' },
      take: limit,
    });
    return Promise.all(rows.map((row) => this.messageToJson(row)));
  }

  async send(
    conversationId: string,
    user: AuthenticatedUser,
    content: string,
    attachments: Array<{ url: string; type: string; name?: string }> = [],
  ): Promise<unknown> {
    const conversation = await this.member(conversationId, user.mysqlId);
    if (conversation.blocked_by_user_one_at || conversation.blocked_by_user_two_at) {
      throw new AppError('CONVERSATION_BLOCKED', 'Cette conversation est bloquée.', 403);
    }
    const otherId = this.otherMysqlId(conversation, user.mysqlId);
    // Blocage générique compte-à-compte (§29) — distinct du blocage de
    // conversation ci-dessus : ferme aussi les nouvelles conversations entre
    // les deux comptes, pas seulement celle-ci.
    if (await this.moderation.isBlockedEitherWay(user.mysqlId, otherId)) {
      throw new AppError('CONVERSATION_BLOCKED', 'Cette conversation est bloquée.', 403);
    }
    if (!content.trim()) throw new AppError('MESSAGE_EMPTY', 'Le message ne peut pas être vide.', 400);

    const message = await this.prisma.messages.create({
      data: {
        conversation_id: Number(conversationId),
        sender_id: user.mysqlId,
        content: content.trim(),
        message_attachments: attachments.length
          ? { create: attachments.map((a) => ({ url: a.url, type: a.type, name: a.name })) }
          : undefined,
      },
      include: { message_attachments: true },
    });

    const otherMirrorId = (await this.auth.resolveMirrorId(otherId)) ?? String(otherId);
    const payload = { conversationId, message: await this.messageToJson(message) };
    this.realtime.emitToUser(otherMirrorId, RealtimeEvent.MessageNew, payload);
    await this.notifications.create({
      userId: otherMirrorId,
      type: 'message.received',
      title: `Nouveau message de ${user.phone}`,
      body: content.trim(),
      data: { screen: 'conversation', conversationId },
    });

    return this.messageToJson(message);
  }

  /**
   * Bloquer ferme le CANAL dans les deux sens (`send` refuse dès qu'un
   * participant, quel qu'il soit, a bloqué) — un blocage à sens unique
   * laisserait l'autre partie continuer à écrire sans le savoir.
   */
  async block(conversationId: string, userMysqlId: number): Promise<{ blocked: true }> {
    const conversation = await this.member(conversationId, userMysqlId);
    const field = conversation.user_one_id === userMysqlId ? 'blocked_by_user_one_at' : 'blocked_by_user_two_at';
    await this.prisma.conversations.update({ where: { id: conversation.id }, data: { [field]: new Date() } });
    return { blocked: true };
  }

  async unblock(conversationId: string, userMysqlId: number): Promise<{ blocked: false }> {
    const conversation = await this.member(conversationId, userMysqlId);
    const field = conversation.user_one_id === userMysqlId ? 'blocked_by_user_one_at' : 'blocked_by_user_two_at';
    await this.prisma.conversations.update({ where: { id: conversation.id }, data: { [field]: null } });
    return { blocked: false };
  }

  async report(conversationId: string, reporterMirrorId: string, userMysqlId: number, reason?: string): Promise<{ reported: true }> {
    await this.member(conversationId, userMysqlId);
    await this.moderation.fileReport({ reporterId: reporterMirrorId, targetType: 'conversation', targetId: conversationId, reason });
    return { reported: true };
  }

  /**
   * Marque tout comme lu d'un coup, pas message par message : un accusé de
   * lecture par ligne exigerait un aller-retour réseau par message affiché,
   * pour un gain imperceptible côté utilisateur.
   */
  async markRead(conversationId: string, userMysqlId: number): Promise<{ read: true }> {
    await this.member(conversationId, userMysqlId);
    await this.prisma.messages.updateMany({
      where: { conversation_id: Number(conversationId), sender_id: { not: userMysqlId }, is_read: false },
      data: { is_read: true },
    });
    return { read: true };
  }

  async setArchived(conversationId: string, userMysqlId: number, archived: boolean): Promise<{ archived: boolean }> {
    const conversation = await this.member(conversationId, userMysqlId);
    const field = conversation.user_one_id === userMysqlId ? 'archived_by_user_one_at' : 'archived_by_user_two_at';
    await this.prisma.conversations.update({ where: { id: conversation.id }, data: { [field]: archived ? new Date() : null } });
    return { archived };
  }

  /**
   * Message d'une conversation dont je suis membre — sans restriction sur
   * l'auteur : supprimer « pour moi » s'applique à n'importe quel message,
   * envoyé ou reçu, comme sur les messageries grand public.
   */
  private async messageIn(conversationId: string, messageId: string, userMysqlId: number) {
    await this.member(conversationId, userMysqlId);
    const message = await this.prisma.messages.findFirst({
      where: { id: Number(messageId), conversation_id: Number(conversationId) },
      include: { message_attachments: true },
    });
    if (!message) throw AppError.notFound('Message');
    return message;
  }

  /** Idem, réservé à l'auteur — seule l'édition l'exige, jamais la suppression « pour moi ». */
  private async ownMessage(conversationId: string, messageId: string, userMysqlId: number) {
    const message = await this.messageIn(conversationId, messageId, userMysqlId);
    if (message.sender_id !== userMysqlId) {
      throw new AppError('FORBIDDEN', 'Seul l’auteur peut modifier ce message.', 403);
    }
    if (message.deleted_by_sender_at) {
      throw new AppError('MESSAGE_DELETED', 'Ce message a été supprimé.', 409);
    }
    return message;
  }

  async editMessage(conversationId: string, messageId: string, userMysqlId: number, content: string): Promise<unknown> {
    if (!content.trim()) throw new AppError('MESSAGE_EMPTY', 'Le message ne peut pas être vide.', 400);
    await this.ownMessage(conversationId, messageId, userMysqlId);
    const message = await this.prisma.messages.update({
      where: { id: Number(messageId) },
      data: { content: content.trim(), edited_at: new Date() },
      include: { message_attachments: true },
    });

    const conversation = await this.prisma.conversations.findUnique({ where: { id: Number(conversationId) } });
    const otherId = conversation ? this.otherMysqlId(conversation, userMysqlId) : undefined;
    if (otherId) {
      const otherMirrorId = (await this.auth.resolveMirrorId(otherId)) ?? String(otherId);
      this.realtime.emitToUser(otherMirrorId, RealtimeEvent.MessageNew, {
        conversationId,
        message: await this.messageToJson(message),
        edited: true,
      });
    }
    return this.messageToJson(message);
  }

  /**
   * Suppression « pour moi » uniquement — le contenu et les pièces jointes
   * restent intacts pour l'autre participant, qui ne voit donc passer aucun
   * événement temps réel : rien n'a changé de son côté.
   */
  async deleteMessage(conversationId: string, messageId: string, userMysqlId: number): Promise<{ deleted: true }> {
    const message = await this.messageIn(conversationId, messageId, userMysqlId);
    const field = message.sender_id === userMysqlId ? 'deleted_by_sender_at' : 'deleted_by_recipient_at';
    await this.prisma.messages.update({ where: { id: message.id }, data: { [field]: new Date() } });
    return { deleted: true };
  }

  private async toJson(row: ConversationRow): Promise<unknown> {
    const oneMirrorId = (await this.auth.resolveMirrorId(row.user_one_id)) ?? String(row.user_one_id);
    const twoMirrorId = (await this.auth.resolveMirrorId(row.user_two_id)) ?? String(row.user_two_id);
    const shopOwnerMysqlId = row.shops?.user_id;

    const [unreadForOne, unreadForTwo, lastMessage] = await Promise.all([
      this.prisma.messages.count({ where: { conversation_id: row.id, sender_id: row.user_two_id, is_read: false } }),
      this.prisma.messages.count({ where: { conversation_id: row.id, sender_id: row.user_one_id, is_read: false } }),
      this.prisma.messages.findFirst({ where: { conversation_id: row.id }, orderBy: { created_at: 'desc' } }),
    ]);

    const blockedBy: string[] = [];
    if (row.blocked_by_user_one_at) blockedBy.push(oneMirrorId);
    if (row.blocked_by_user_two_at) blockedBy.push(twoMirrorId);

    const lastMessageSenderMirrorId = lastMessage
      ? lastMessage.sender_id === row.user_one_id
        ? oneMirrorId
        : twoMirrorId
      : undefined;

    return {
      id: String(row.id),
      participants: [
        {
          userId: oneMirrorId,
          name: `${row.users_conversations_user_one_idTousers.firstname} ${row.users_conversations_user_one_idTousers.lastname}`.trim(),
          avatar: row.users_conversations_user_one_idTousers.avatar ?? undefined,
          shopId: shopOwnerMysqlId === row.user_one_id ? String(row.shop_id) : undefined,
        },
        {
          userId: twoMirrorId,
          name: `${row.users_conversations_user_two_idTousers.firstname} ${row.users_conversations_user_two_idTousers.lastname}`.trim(),
          avatar: row.users_conversations_user_two_idTousers.avatar ?? undefined,
          shopId: shopOwnerMysqlId === row.user_two_id ? String(row.shop_id) : undefined,
        },
      ],
      unread: { [oneMirrorId]: unreadForOne, [twoMirrorId]: unreadForTwo },
      lastMessage: lastMessage ? { content: lastMessage.content, senderId: lastMessageSenderMirrorId, sentAt: lastMessage.created_at } : undefined,
      blockedBy,
    };
  }

  private async messageToJson(message: Prisma.messagesGetPayload<{ include: { message_attachments: true } }>): Promise<unknown> {
    const senderMirrorId = (await this.auth.resolveMirrorId(message.sender_id)) ?? String(message.sender_id);
    return {
      id: String(message.id),
      conversationId: String(message.conversation_id),
      senderId: senderMirrorId,
      content: message.content ?? undefined,
      attachments: message.message_attachments.map((a) => ({ url: a.url, type: a.type, name: a.name ?? undefined })),
      isRead: message.is_read ?? false,
      editedAt: message.edited_at ?? undefined,
      createdAt: message.created_at,
    };
  }
}
