import type { Role } from '../rbac/roles';

export interface RoleAssignment {
  role: Role | string;
  /** Portée du rôle. Absent pour les rôles globaux (`client`, `platform_admin`). */
  shopId?: string;
}

/** Charge utile portée par `request.user` après validation du JWT. */
export interface AuthenticatedUser {
  /**
   * Pont d'identité transitoire (§ décision du 2026-09-09, migration Mongo →
   * MySQL) : un ObjectId stable par utilisateur MySQL (`identityShadows`),
   * pour que les modules pas encore migrés (`new Types.ObjectId(user.id)`,
   * `.findById(user.id)`) continuent de fonctionner sans changement. Disparaît
   * une fois tous les modules migrés — `mysqlId` devient alors l'identifiant.
   */
  id: string;
  /** Vrai identifiant entier MySQL (`users.id`) — à utiliser par tout module migré. */
  mysqlId: number;
  phone: string;
  roles: RoleAssignment[];
  /** Identifiant de session de rafraîchissement, pour la rotation et la révocation. */
  sid?: string;
}
