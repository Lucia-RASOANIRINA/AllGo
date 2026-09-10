/** Cibles favorisables — §10. Un produit reste le cas d'usage dominant. */
export const FAVORITABLE_TYPES = ['product', 'shop', 'promotion', 'post'] as const;
export type FavoriteTargetType = (typeof FAVORITABLE_TYPES)[number];
