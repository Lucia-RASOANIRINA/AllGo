import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY, PUBLIC_KEY, SCOPE_PARAM_KEY } from '../decorators/auth.decorators';
import { ROLE_SCOPE, Role } from '../rbac/roles';
import { PERMISSIONS_WITHOUT_SHOP_SCOPE, permissionsOf, type PermissionValue } from '../rbac/permissions';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Garde de permissions appliqué globalement, après `JwtAuthGuard`.
 *
 * Deux vérifications, jamais une seule :
 *   1. l'utilisateur détient-il la permission ?
 *   2. la détient-il **dans la portée demandée** ?
 *
 * Le point 2 est ce qui manquait au web : une autorisation de boutique pouvait
 * s'appliquer à toute la plateforme.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<PermissionValue>(PERMISSION_KEY, targets);

    // Route authentifiée sans permission déclarée : refus. Une route sans garde
    // ne doit jamais atteindre la production — le test d'ossature la détecte en CI.
    if (!required) {
      throw new ForbiddenException({
        code: 'PERMISSION_NOT_DECLARED',
        message: "Cette action n'est pas autorisée.",
      });
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Accès refusé.' });

    const scopeParam = this.reflector.getAllAndOverride<string>(SCOPE_PARAM_KEY, targets);
    // Une route de lecture porte sa portée en chaîne de requête (`?shopId=`),
    // jamais dans un corps — sans ce troisième repli, toute route `GET`
    // filtrée par boutique (ex. solde commerçant, §30) serait refusée à qui
    // détient pourtant la permission, faute de savoir où lire `shopId`.
    const shopId = scopeParam
      ? (request.params?.[scopeParam] ?? request.body?.[scopeParam] ?? request.query?.[scopeParam])
      : undefined;

    if (this.holds(user, required, shopId)) return true;

    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: "Vous n'avez pas les droits nécessaires pour cette action.",
      details: { permission: required, shopId: shopId ?? null },
    });
  }

  /** L'utilisateur détient-il `permission`, dans la portée `shopId` si elle est exigée ? */
  private holds(user: AuthenticatedUser, permission: PermissionValue, shopId?: string): boolean {
    return user.roles.some((assignment) => {
      const role = assignment.role as Role;
      if (!permissionsOf(role).has(permission)) return false;

      if (ROLE_SCOPE[role] === 'global') return true;
      if (PERMISSIONS_WITHOUT_SHOP_SCOPE.has(permission)) return true;

      // Rôle de portée boutique : la route DOIT nommer la boutique visée.
      // Sans portée explicite, l'autorisation est refusée — jamais élargie.
      if (!shopId) return false;
      return String(assignment.shopId) === String(shopId);
    });
  }
}
