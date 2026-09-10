/** Catalogue des notifications — §10.1. */
export const NOTIFICATION_TYPES = [
  'order.created',
  'order.confirmed',
  'order.prepared',
  'order.shipped',
  'order.awaiting_payment',
  'delivery.assigned',
  'delivery.started',
  'order.delivered',
  'message.received',
  'social.comment',
  'social.comment_reply',
  'promo.new',
  'promo.flash',
  'shop.product_new',
  'shop.nearby',
  'recommendation.new',
  'social.reaction',
  'request.response',
  'request.new_match',
  'stock.low',
  'promo.nearby',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_CATEGORIES = [
  'orders',
  'promotions',
  'social',
  'messages',
  'delivery',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
