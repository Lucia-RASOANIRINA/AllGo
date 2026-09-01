import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import {
  Notification,
  type NotificationDocument,
  type NotificationType,
} from './schemas/notification.schema';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { EventsGateway, RealtimeEvent } from '../realtime/events.gateway';

/** Types dont la livraison prime sur le respect des heures calmes (§10.2). */
const CRITICAL_TYPES: ReadonlySet<NotificationType> = new Set([
  'order.created',
  'order.awaiting_payment',
  'delivery.assigned',
]);

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private readonly notifications: Model<NotificationDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly realtime: EventsGateway,
  ) {}

  async create(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }): Promise<unknown> {
    const notification = await this.notifications.create({
      userId: new Types.ObjectId(input.userId),
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
    });
    const payload = notification.toJSON();
    const user = await this.users.findById(input.userId).select('preferences').lean();
    const category = NotificationsService.categoryFor(input.type);
    const enabled = NotificationsService.categoryEnabled(user?.preferences?.pushCategories, category);
    if (enabled &&
        user?.preferences?.pushEnabled !== false &&
        NotificationsService.isDeliverableNow(input.type, new Date().getHours())) {
      this.realtime.emitToUser(input.userId, RealtimeEvent.NotificationNew, payload);
    }
    return payload;
  }

  async list(userId: string, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const docs = await this.notifications
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

  async markRead(userId: string, ids?: string[]): Promise<{ updated: number }> {
    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      isRead: false,
    };
    if (ids?.length) filter._id = { $in: ids.map((id) => new Types.ObjectId(id)) };

    const result = await this.notifications.updateMany(filter, { $set: { isRead: true } });
    return { updated: result.modifiedCount };
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

  /**
   * `preferences.pushCategories` est un `Map` Mongoose côté schéma, mais
   * `.lean()` (utilisé juste au-dessus) ne le reconstruit JAMAIS en `Map` —
   * BSON n'a pas ce type, `Map` n'existe que côté document hydraté. Sans ce
   * garde, un objet brut `{}` fait planter `create()` sur `.get is not a
   * function` pour tout utilisateur n'ayant jamais personnalisé ses
   * catégories — c'est-à-dire, par construction du schéma, un compte neuf.
   */
  private static categoryEnabled(pushCategories: unknown, category: string): boolean {
    if (pushCategories instanceof Map) return pushCategories.get(category) !== false;
    if (pushCategories && typeof pushCategories === 'object') {
      return (pushCategories as Record<string, boolean>)[category] !== false;
    }
    return true;
  }
}
