export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  /**
   * `preparing` n'existe pas dans le web : impossible d'y distinguer
   * « commande acceptée » de « commande en préparation », ce qui rend le suivi
   * client imprécis (§6.2).
   */
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Transitions autorisées. Toute autre transition est refusée par le service. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};
