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

/**
 * v2 : ajout de `PostShare`, `PostReport`, `MessageBlock`, `MessageReport`,
 * `OrderDispute` — fonctionnalités précédemment absentes (partage/signalement
 * de publication, blocage/signalement de conversation, litige de commande).
 * Aucune permission existante retirée ni renommée.
 */
export const PERMISSIONS_VERSION = 2;

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
  ShopCreate: 'shop:create',
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
  OrderDispute: 'order:dispute',

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
  PostUpdate: 'post:update',
  PostShare: 'post:share',
  PostReport: 'post:report',
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
  MessageBlock: 'message:block',
  MessageReport: 'message:report',
  NotificationRead: 'notification:read',
  ReviewRead: 'review:read',
  ReviewCreate: 'review:create',
  ReviewUpdate: 'review:update',
  ReviewDelete: 'review:delete',
  ReviewReport: 'review:report',

  // --- Livraison ---
  DeliveryReadOwn: 'delivery:read_own',
  DeliveryUpdate: 'delivery:update',
  DeliveryProof: 'delivery:proof',
  CourierEarningsRead: 'courier:earnings_read',

  // --- Médias ---
  MediaUpload: 'media:upload',

  // --- Marketing ---
  CampaignRead: 'campaign:read',
  CampaignCreate: 'campaign:create',
  CampaignUpdate: 'campaign:update',
  CampaignDelete: 'campaign:delete',

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
  Permission.ShopCreate,
  Permission.CartManage,
  Permission.OrderCreate,
  Permission.OrderReadOwn,
  Permission.OrderCancel,
  Permission.OrderDispute,
  Permission.PaymentInitiate,
  Permission.InvoiceRead,
  Permission.PostRead,
  Permission.PostCreate,
  Permission.PostDelete, Permission.PostUpdate,
  Permission.PostShare,
  Permission.PostReport,
  Permission.CommentCreate,
  Permission.ReactionToggle,
  Permission.StoryCreate,
  Permission.FollowToggle,
  Permission.RequestCreate,
  Permission.RequestRead,
  Permission.MessageRead,
  Permission.MessageSend,
  Permission.MessageBlock,
  Permission.MessageReport,
  Permission.NotificationRead,
  Permission.ReviewRead,
  Permission.ReviewCreate,
  Permission.ReviewUpdate,
  Permission.ReviewDelete,
  Permission.ReviewReport,
  Permission.MediaUpload,
];

const SHOP_BASE: PermissionValue[] = [
  Permission.ShopRead,
  Permission.ProductRead,
  Permission.OrderReadShop,
  Permission.MessageRead,
  Permission.MessageSend,
  Permission.MessageBlock,
  Permission.MessageReport,
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
    Permission.PostDelete, Permission.PostUpdate,
    Permission.RequestRead,
    Permission.RequestRespond,
    Permission.CampaignRead, Permission.CampaignCreate, Permission.CampaignUpdate, Permission.CampaignDelete,
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
    Permission.CourierEarningsRead,
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

/**
 * Permissions qui échappent à la portée boutique de leur rôle porteur (§26).
 *
 * `ShopCourier` est un rôle de boutique par construction du modèle (§3.1) —
 * l'équipe d'une boutique reste la façon dont un livreur y est rattaché.
 * Mais un livreur exerce sur TOUTE la plateforme (missions, revenus,
 * retraits) : `OrdersService.courierMissions()` ne filtre par aucune
 * boutique, et il n'existe pas de route `/shop/:shopId/courier/...` où
 * nommer une portée. Sans cette liste, `PermissionsGuard.holds()` refuse
 * systématiquement ces quatre permissions — c'est un livreur entièrement
 * verrouillé hors de son propre espace, découvert seulement en exécutant
 * l'application (§4.2 : « validé » signifie exécuté).
 *
 * Volontairement restreinte à ces quatre permissions : `OrderReadShop` et
 * `PaymentCollect`, portées par le même rôle, doivent rester cantonnées à la
 * boutique de l'affectation — les y ajouter romprait exactement la faille
 * que `PermissionsGuard` corrige (§3.1).
 */
export const PERMISSIONS_WITHOUT_SHOP_SCOPE: ReadonlySet<PermissionValue> = new Set([
  Permission.DeliveryReadOwn,
  Permission.DeliveryUpdate,
  Permission.DeliveryProof,
  Permission.CourierEarningsRead,
]);
