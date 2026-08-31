/**
 * Un panier peut contenir des articles de plusieurs boutiques : une commande
 * est créée par boutique, chacune ayant son propre suivi et sa propre
 * livraison. Partagé entre `OrdersService.create` et `CartService.preview`,
 * qui ont toutes deux besoin du même regroupement.
 */
export function groupByShop<T extends { snapshot: { shopId: unknown } }>(
  items: T[],
): Map<string, T[]> {
  const byShop = new Map<string, T[]>();
  for (const item of items) {
    const key = String(item.snapshot.shopId);
    byShop.set(key, [...(byShop.get(key) ?? []), item]);
  }
  return byShop;
}
