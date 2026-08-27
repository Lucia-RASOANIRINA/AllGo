/**
 * Modèle de rôles unifié — §3.1 du cahier des charges.
 *
 * Le web superpose trois mécanismes indépendants (rôle de plateforme, niveau
 * d'administration, rôle d'équipe) et enregistre un caissier comme `merchant`,
 * ce qui a directement causé la faille d'accès `/admin/merchant-accounts/*`.
 *
 * Ici : un seul mécanisme. Un utilisateur porte une liste de rôles, chacun
 * éventuellement rattaché à une portée (`shopId`).
 */

export enum Role {
  Client = 'client',
  ShopOwner = 'shop_owner',
  ShopManager = 'shop_manager',
  ShopSales = 'shop_sales',
  ShopCashier = 'shop_cashier',
  ShopStock = 'shop_stock',
  ShopCourier = 'shop_courier',
  ShopMarketing = 'shop_marketing',
  PlatformAdmin = 'platform_admin',
}

/** Portée d'un rôle : globale, ou limitée à une boutique. */
export type RoleScope = 'global' | 'shop';

export const ROLE_SCOPE: Record<Role, RoleScope> = {
  [Role.Client]: 'global',
  [Role.ShopOwner]: 'shop',
  [Role.ShopManager]: 'shop',
  [Role.ShopSales]: 'shop',
  [Role.ShopCashier]: 'shop',
  [Role.ShopStock]: 'shop',
  [Role.ShopCourier]: 'shop',
  [Role.ShopMarketing]: 'shop',
  [Role.PlatformAdmin]: 'global',
};

/** Rôles dont la portée est une boutique — utile aux gardes et aux validateurs. */
export const SHOP_SCOPED_ROLES: readonly Role[] = Object.values(Role).filter(
  (r) => ROLE_SCOPE[r] === 'shop',
);
