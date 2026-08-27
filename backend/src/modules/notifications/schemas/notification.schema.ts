import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

/** Catalogue des notifications — §10.1. */
export const NOTIFICATION_TYPES = [
  'order.created',
  'order.status_changed',
  'order.awaiting_payment',
  'delivery.assigned',
  'delivery.started',
  'message.received',
  'request.response',
  'request.new_match',
  'stock.low',
  'social.reaction',
  'social.comment',
  'promo.nearby',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

@Schema({ collection: 'notifications', timestamps: { createdAt: true, updatedAt: false } })
export class Notification extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ type: String, enum: NOTIFICATION_TYPES, required: true }) type!: NotificationType;

  /** Titre et corps **déjà localisés** : affichables sans appel API (§10.2). */
  @Prop({ required: true }) title!: string;
  @Prop({ required: true }) body!: string;

  /** Charge utile du lien profond : `{ screen: 'order', orderId: '…' }`. */
  @Prop({ type: Object, default: {} }) data!: Record<string, unknown>;

  @Prop({ default: false }) isRead!: boolean;

  /** Purge automatique après 90 jours. */
  @Prop({ type: Date, default: () => new Date(Date.now() + 90 * 24 * 3600 * 1000) })
  expiresAt!: Date;

  createdAt!: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, isRead: 1 });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
