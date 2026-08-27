/**
 * Catalogue de permissions — §3.2 du cahier des charges.
 *
 * Les permissions sont des chaînes explicites `<ressource>:<action>`. Chaque
 * point d'entrée d'API déclare la permission et la portée qu'il exige ; aucune
 * route ne peut être publiée sans déclaration (voir `routes-guard.spec.ts`).
 *
 * Table de référence VERSIONNÉE : toute modification incrémente
 * `PERMISSIONS_VERSION` et doit être accompagnée d'une note de migration.
 */

import { Role } from './roles';

export const PERMISSIONS_VERSION = 1;

export const Permission = {
  // --- Session ---
  /**
   * Agir sur sa propre session (déconnexion, révocation).
   *
   * Ne porte sur aucune ressource métier : c'est la permission d'un compte sur
   * lui-même. Elle est attachée au rôle global `client`, que tout compte
   * possède par défaut (`users.roles` — voir le schéma). Une route de session
   * exige donc une authentification, mais aucun droit particulier.
   */
  SessionManage: 'session:manage',

  // --- Profil ---
  ProfileRead: 'profile:read',
  ProfileUpdate: 'profile:update',

  // --- Catalogue ---
  ProductRead: 'product:read',
  ProductCreate: 'product:create',
  ProductUpdate: 'product:update',
  ProductDelete: 'product:delete',

  // --- Boutique ---
  ShopRead: 'shop:read',
  ShopUpdate: 'shop:update',
  ShopDashboard: 'shop:dashboard',
  TeamManage: 'team:manage',

  // --- Panier & commandes ---
  CartManage: 'cart:manage',
  OrderCreate: 'order:create',
  OrderReadOwn: 'order:read_own',
  OrderReadShop: 'order:read_shop',
  OrderUpdateStatus: 'order:update_status',
  OrderCancel: 'order:cancel',

  // --- Paiement & facturation ---
  PaymentInitiate: 'payment:initiate',
  PaymentCollect: 'payment:collect',
  InvoiceRead: 'invoice:read',
  InvoiceCreate: 'invoice:create',
  RefundCreate: 'refund:create',

  // --- Stock ---
  StockRead: 'stock:read',
  StockMove: 'stock:move',
  StockAlertRead: 'stock:alert_read',

  // --- Social ---
  PostRead: 'post:read',
  PostCreate: 'post:create',
  PostDelete: 'post:delete',
  CommentCreate: 'comment:create',
  ReactionToggle: 'reaction:toggle',
  StoryCreate: 'story:create',
  FollowToggle: 'follow:toggle',

  // --- Demandes clients ---
  RequestCreate: 'request:create',
  RequestRead: 'request:read',
  RequestRespond: 'request:respond',

  // --- Messagerie & notifications ---
  MessageRead: 'message:read',
  MessageSend: 'message:send',
  NotificationRead: 'notification:read',

  // --- Livraison ---
  DeliveryReadOwn: 'delivery:read_own',
  DeliveryUpdate: 'delivery:update',
  DeliveryProof: 'delivery:proof',

  // --- Médias ---
  MediaUpload: 'media:upload',

  // --- Marketing ---
  CampaignRead: 'campaign:read',

  // --- Plateforme ---
  PlatformModerate: 'platform:moderate',
  PlatformSettings: 'platform:settings',
  AuditRead: 'audit:read',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

/** Permissions attachées au rôle `client`, socle de tout compte. */
const CLIENT_PERMISSIONS: PermissionValue[] = [
  Permission.SessionManage,
  Permission.ProfileRead,
  Permission.ProfileUpdate,
  Permission.ProductRead,
  Permission.ShopRead,
  Permission.CartManage,
  Permission.OrderCreate,
  Permission.OrderReadOwn,
  Permission.OrderCancel,
  Permission.PaymentInitiate,
  Permission.InvoiceRead,
  Permission.PostRead,
  Permission.PostCreate,
  Permission.PostDelete,
  Permission.CommentCreate,
  Permission.ReactionToggle,
  Permission.StoryCreate,
  Permission.FollowToggle,
  Permission.RequestCreate,
  Permission.RequestRead,
  Permission.MessageRead,
  Permission.MessageSend,
  Permission.NotificationRead,
  Permission.MediaUpload,
];

const SHOP_BASE: PermissionValue[] = [
  Permission.ShopRead,
  Permission.ProductRead,
  Permission.OrderReadShop,
  Permission.MessageRead,
  Permission.MessageSend,
  Permission.NotificationRead,
  Permission.MediaUpload,
];

/**
 * Attribution des permissions par rôle.
 *
 * Note : la portée n'est pas portée ici mais par le rôle de l'utilisateur
 * (`roles[].shopId`). `PermissionsGuard` vérifie les deux — une permission de
 * boutique ne peut jamais s'appliquer accidentellement à toute la plateforme,
 * ce qui est exactement l'origine de la faille du web.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly PermissionValue[]> = {
  [Role.Client]: CLIENT_PERMISSIONS,

  [Role.ShopOwner]: [
    ...SHOP_BASE,
    Permission.ShopUpdate,
    Permission.ShopDashboard,
    Permission.TeamManage,
    Permission.ProductCreate,
    Permission.ProductUpdate,
    Permission.ProductDelete,
    Permission.OrderUpdateStatus,
    Permission.OrderCancel,
    Permission.PaymentCollect,
    Permission.InvoiceRead,
    Permission.InvoiceCreate,
    Permission.RefundCreate,
    Permission.StockRead,
    Permission.StockMove,
    Permission.StockAlertRead,
    Permission.PostCreate,
    Permission.PostDelete,
    Permission.RequestRead,
    Permission.RequestRespond,
    Permission.CampaignRead,
  ],

  [Role.ShopManager]: [
    ...SHOP_BASE,
    Permission.ShopDashboard,
    Permission.ProductCreate,
    Permission.ProductUpdate,
    Permission.OrderUpdateStatus,
    Permission.StockRead,
    Permission.StockMove,
    Permission.StockAlertRead,
    Permission.InvoiceRead,
    Permission.PostCreate,
  ],

  [Role.ShopSales]: [
    ...SHOP_BASE,
    Permission.OrderUpdateStatus,
    Permission.RequestRead,
    Permission.RequestRespond,
    Permission.PostCreate,
    Permission.ProductUpdate,
  ],

  [Role.ShopCashier]: [
    ...SHOP_BASE,
    Permission.PaymentCollect,
    Permission.InvoiceRead,
    Permission.InvoiceCreate,
    Permission.OrderUpdateStatus,
  ],

  [Role.ShopStock]: [
    ...SHOP_BASE,
    Permission.StockRead,
    Permission.StockMove,
    Permission.StockAlertRead,
    Permission.ProductUpdate,
  ],

  [Role.ShopCourier]: [
    ...SHOP_BASE,
    Permission.DeliveryReadOwn,
    Permission.DeliveryUpdate,
    Permission.DeliveryProof,
    Permission.PaymentCollect,
  ],

  [Role.ShopMarketing]: [...SHOP_BASE, Permission.CampaignRead, Permission.PostCreate],

  // Le back-office plateforme reste sur le web (§2.1) : le rôle existe pour
  // l'API, mais aucune route mobile ne l'expose.
  [Role.PlatformAdmin]: [
    ...CLIENT_PERMISSIONS,
    Permission.PlatformModerate,
    Permission.PlatformSettings,
    Permission.AuditRead,
    Permission.ShopUpdate,
    Permission.ShopDashboard,
  ],
};

/** Permissions effectives d'un rôle donné, sans doublon. */
export function permissionsOf(role: Role): Set<PermissionValue> {
  return new Set(ROLE_PERMISSIONS[role] ?? []);
}
