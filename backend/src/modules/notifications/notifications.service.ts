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
  ) {}

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
}
