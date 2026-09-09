import { Role } from '../../common/rbac/roles';
import type { RoleAssignment } from '../../common/types/authenticated-user';

/**
 * `shop_team_members.team_role` (site PHP) → `Role` mobile (§3.1 — modèle de
 * rôles unifié, qui existe précisément pour ne plus reproduire la confusion
 * du web entre rôle de plateforme/niveau admin/rôle d'équipe).
 */
const TEAM_ROLE_MAP: Record<string, Role> = {
  manager: Role.ShopManager,
  commercial: Role.ShopSales,
  caissier: Role.ShopCashier,
  stock: Role.ShopStock,
  livreur: Role.ShopCourier,
  marketing: Role.ShopMarketing,
};

export interface MysqlRoleInputs {
  /** `users.role_id` — 1=admin, 2=merchant, 3=client (table `roles` réelle). */
  roleId: number;
  /** `users.admin_level` — nullable, 4 valeurs distinctes côté web. */
  adminLevel: string | null;
  /** Boutiques dont `shops.user_id` est cet utilisateur. */
  ownedShopIds: number[];
  /** Ligne `shop_team_members` de cet utilisateur, `user_id` y est unique. */
  teamMembership: { shopId: number; teamRole: string; status: string } | null;
}

/**
 * Reconstruit `RoleAssignment[]` depuis les tables MySQL réelles — remplace
 * l'ancien tableau `roles` embarqué sur le document Mongo `User`, sans rien
 * changer à `PermissionsGuard`/`permissions.ts` qui consomment ce tableau.
 *
 * Simplification délibérée : les 4 valeurs d'`admin_level`
 * (super_admin/admin/moderator/support) sont toutes ramenées à
 * `Role.PlatformAdmin` — aucune route mobile ne les distingue aujourd'hui.
 */
export function buildRoleAssignments(input: MysqlRoleInputs): RoleAssignment[] {
  const roles: RoleAssignment[] = [{ role: Role.Client }];

  if (input.roleId === 1 || input.adminLevel) {
    roles.push({ role: Role.PlatformAdmin });
  }

  for (const shopId of input.ownedShopIds) {
    roles.push({ role: Role.ShopOwner, shopId: String(shopId) });
  }

  if (input.teamMembership && input.teamMembership.status === 'active') {
    const role = TEAM_ROLE_MAP[input.teamMembership.teamRole];
    if (role) roles.push({ role, shopId: String(input.teamMembership.shopId) });
  }

  return roles;
}
