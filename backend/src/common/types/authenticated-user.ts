import type { Role } from '../rbac/roles';

export interface RoleAssignment {
  role: Role | string;
  /** Portée du rôle. Absent pour les rôles globaux (`client`, `platform_admin`). */
  shopId?: string;
}

/** Charge utile portée par `request.user` après validation du JWT. */
export interface AuthenticatedUser {
  id: string;
  phone: string;
  roles: RoleAssignment[];
  /** Identifiant de session de rafraîchissement, pour la rotation et la révocation. */
  sid?: string;
}
