import { Injectable } from '@nestjs/common';

import type { Paginated } from '../../common/http/response.interceptor';
import { decodeCursor, encodeCursor, prismaCursorFilter } from '../../common/pagination/cursor';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EventsGateway, RealtimeEvent } from '../realtime/events.gateway';
import type { NotificationType } from './schemas/notification.schema';

/** Types dont la livraison prime sur le respect des heures calmes (§10.2). */
const CRITICAL_TYPES: ReadonlySet<NotificationType> = new Set([
  'order.created',
  'order.awaiting_payment',
  'delivery.assigned',
]);

/** Rétention avant purge automatique — 90 jours, alignée sur l'ancien TTL Mongo (§10.1). */
const RETENTION_MS = 90 * 24 * 3600 * 1000;

interface NotificationRow {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  is_read: boolean | null;
  created_at: Date | null;
}

/**
 * Table MySQL réelle `notifications` — partagée avec le site web JangaMarket.
 * Avant cette réécriture, ce service écrivait dans une collection Mongo
 * séparée : une notification créée côté mobile n'apparaissait jamais côté
 * web, et inversement (deux silos qui ne se voient pas).
 *
 * Les préférences de diffusion (`pushEnabled`/`pushCategories`) vivent sur
 * `prisma.users` depuis la Phase 6 (colonnes ajoutées lors de la suppression
 * complète du miroir Mongo `User`).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: EventsGateway,
  ) {}

  async create(input: {
    userId: number;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }): Promise<unknown> {
    const row = await this.prisma.notifications.create({
      data: {
        user_id: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data && Object.keys(input.data).length ? JSON.stringify(input.data) : null,
        expires_at: new Date(Date.now() + RETENTION_MS),
      },
    });
    const payload = this.toJson(row);

    const recipient = await this.prisma.users.findUnique({
      where: { id: input.userId },
      select: { push_enabled: true, push_categories: true },
    });
    const category = NotificationsService.categoryFor(input.type);
    const enabled = NotificationsService.categoryEnabled(recipient?.push_categories, category);
    if (
      enabled &&
      recipient?.push_enabled !== false &&
      NotificationsService.isDeliverableNow(input.type, new Date().getHours())
    ) {
      this.realtime.emitToUser(String(input.userId), RealtimeEvent.NotificationNew, payload);
    }
    return payload;
  }

  async list(userMysqlId: number, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const where: Record<string, unknown> = { user_id: userMysqlId };
    if (cursor) Object.assign(where, prismaCursorFilter('created_at', decodeCursor(cursor)));

    const rows = await this.prisma.notifications.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((row) => this.toJson(row));
    const last = page[page.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last && last.created_at
          ? encodeCursor({ value: last.created_at.toISOString(), id: String(last.id) })
          : null,
    };
  }

  async markRead(userMysqlId: number, ids?: string[]): Promise<{ updated: number }> {
    const where: Record<string, unknown> = { user_id: userMysqlId, is_read: false };
    if (ids?.length) where.id = { in: ids.map((id) => Number(id)) };

    const result = await this.prisma.notifications.updateMany({ where, data: { is_read: true } });
    return { updated: result.count };
  }

  /** Purge les notifications expirées — appelé par `NotificationsCleanupService` (§10.1). */
  async purgeExpired(): Promise<{ deleted: number }> {
    const result = await this.prisma.notifications.deleteMany({ where: { expires_at: { lt: new Date() } } });
    return { deleted: result.count };
  }

  private toJson(row: NotificationRow): unknown {
    return {
      id: String(row.id),
      type: row.type,
      title: row.title,
      body: row.body ?? '',
      data: row.data ? JSON.parse(row.data) : {},
      isRead: row.is_read ?? false,
      createdAt: row.created_at,
    };
  }

  /**
   * Une notification non critique tombant dans les heures calmes est différée
   * à 7 h plutôt que supprimée : l'information reste due, elle n'est pas urgente.
   */
  static isDeliverableNow(type: NotificationType, localHour: number): boolean {
    if (CRITICAL_TYPES.has(type)) return true;
    return localHour >= 7 && localHour < 21;
  }

  static categoryFor(
    type: NotificationType,
  ): 'orders' | 'promotions' | 'social' | 'messages' | 'delivery' {
    if (type.startsWith('order.')) return 'orders';
    if (type.startsWith('promo.')) return 'promotions';
    if (type.startsWith('message.')) return 'messages';
    if (type.startsWith('delivery.')) return 'delivery';
    return 'social';
  }

  private static categoryEnabled(pushCategories: unknown, category: string): boolean {
    if (pushCategories && typeof pushCategories === 'object') {
      return (pushCategories as Record<string, boolean>)[category] !== false;
    }
    return true;
  }
}
