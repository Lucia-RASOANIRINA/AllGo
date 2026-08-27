import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PermissionValue } from '../rbac/permissions';

export const PUBLIC_KEY = 'allgo:public';
export const PERMISSION_KEY = 'allgo:permission';
export const SCOPE_PARAM_KEY = 'allgo:scopeParam';

/**
 * Marque une route accessible sans authentification.
 *
 * `@Public()` est la SEULE façon d'ouvrir une route : en l'absence de
 * `@Public()` ou de `@RequirePermission()`, le garde d'ossature refuse la route
 * et le test `routes-guard.spec.ts` échoue en intégration continue (§12.1).
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Déclare la permission exigée par une route.
 *
 * @param permission Permission au format `<ressource>:<action>`.
 * @param scopeParam Nom du paramètre de route portant l'identifiant de boutique
 *   lorsque la permission est de portée boutique. Exemple : `@RequirePermission(
 *   Permission.OrderUpdateStatus, 'shopId')` sur `PATCH /shop/:shopId/orders/:id`.
 *   Sans ce paramètre, la permission doit être détenue à portée globale.
 */
export const RequirePermission = (permission: PermissionValue, scopeParam?: string) => {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(PERMISSION_KEY, permission)(
      target,
      key as string,
      descriptor as PropertyDescriptor,
    );
    if (scopeParam) {
      SetMetadata(SCOPE_PARAM_KEY, scopeParam)(
        target,
        key as string,
        descriptor as PropertyDescriptor,
      );
    }
  };
};

/** Injecte l'utilisateur authentifié (charge utile du JWT enrichie). */
export const CurrentUser = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return field ? request.user?.[field] : request.user;
  },
);
