import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PERMISSION_KEY, PUBLIC_KEY, SCOPE_PARAM_KEY } from '../decorators/auth.decorators';
import { Permission } from '../rbac/permissions';
import { Role } from '../rbac/roles';
import type { AuthenticatedUser } from '../types/authenticated-user';
import { PermissionsGuard } from './permissions.guard';

/**
 * Ces tests décrivent la faille du web que le modèle corrige.
 *
 * Le système actuel enregistre un caissier comme `merchant` et n'attache
 * aucune portée à ses autorisations : la permission accordée pour une boutique
 * s'appliquait à toute la plateforme, ce qui est l'origine directe de la faille
 * `/admin/merchant-accounts/*` (§3.1, §10.2 du document système).
 */
describe('PermissionsGuard', () => {
  const SHOP_A = '6712ab0000000000000000aa';
  const SHOP_B = '6798cd0000000000000000bb';

  function contextFor(
    user: AuthenticatedUser | undefined,
    params: Record<string, string> = {},
    query: Record<string, string> = {},
  ): ExecutionContext {
    const request = { user, params, body: {}, query };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as unknown as ExecutionContext;
  }

  function guardWith(metadata: Record<string, unknown>): PermissionsGuard {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    return new PermissionsGuard(reflector);
  }

  const client: AuthenticatedUser = {
    id: 'u1',
    mysqlId: 1,
    phone: '+261340000002',
    roles: [{ role: Role.Client }],
  };

  const cashierOfA: AuthenticatedUser = {
    id: 'u2',
    mysqlId: 2,
    phone: '+261340000003',
    roles: [{ role: Role.Client }, { role: Role.ShopCashier, shopId: SHOP_A }],
  };

  it('laisse passer une route publique sans même regarder l’utilisateur', () => {
    const guard = guardWith({ [PUBLIC_KEY]: true });
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  it('REFUSE une route authentifiée qui ne déclare aucune permission', () => {
    // Sécurité par défaut : oublier `@RequirePermission()` ferme la route au
    // lieu de l'ouvrir. C'est l'inverse exact du modèle web.
    const guard = guardWith({});
    expect(() => guard.canActivate(contextFor(client))).toThrow(ForbiddenException);
  });

  it('accorde une permission globale à un rôle global', () => {
    const guard = guardWith({ [PERMISSION_KEY]: Permission.OrderCreate });
    expect(guard.canActivate(contextFor(client))).toBe(true);
  });

  it('refuse une permission que le rôle ne porte pas', () => {
    const guard = guardWith({ [PERMISSION_KEY]: Permission.PlatformModerate });
    expect(() => guard.canActivate(contextFor(client))).toThrow(ForbiddenException);
  });

  describe('portée des rôles de boutique', () => {
    it('accorde la permission dans la boutique de l’utilisateur', () => {
      const guard = guardWith({
        [PERMISSION_KEY]: Permission.PaymentCollect,
        [SCOPE_PARAM_KEY]: 'shopId',
      });
      expect(guard.canActivate(contextFor(cashierOfA, { shopId: SHOP_A }))).toBe(true);
    });

    it('REFUSE la même permission dans une autre boutique', () => {
      const guard = guardWith({
        [PERMISSION_KEY]: Permission.PaymentCollect,
        [SCOPE_PARAM_KEY]: 'shopId',
      });
      expect(() => guard.canActivate(contextFor(cashierOfA, { shopId: SHOP_B }))).toThrow(
        ForbiddenException,
      );
    });

    it('REFUSE une permission de boutique sur une route sans portée déclarée', () => {
      // C'est le cœur de la correction : sans portée nommée par la route, une
      // autorisation de boutique ne peut pas s'élargir à la plateforme.
      const guard = guardWith({ [PERMISSION_KEY]: Permission.PaymentCollect });
      expect(() => guard.canActivate(contextFor(cashierOfA))).toThrow(ForbiddenException);
    });

    it('accorde la permission quand la boutique est nommée en chaîne de requête (§30)', () => {
      // Une route `GET` filtrée (`?shopId=`) n'a ni corps ni paramètre de
      // route pour porter la portée — sans ce repli, un solde commerçant
      // resterait inaccessible à son propre propriétaire.
      const guard = guardWith({
        [PERMISSION_KEY]: Permission.PaymentCollect,
        [SCOPE_PARAM_KEY]: 'shopId',
      });
      expect(guard.canActivate(contextFor(cashierOfA, {}, { shopId: SHOP_A }))).toBe(true);
      expect(() => guard.canActivate(contextFor(cashierOfA, {}, { shopId: SHOP_B }))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('livreur — permissions sans portée boutique (§26)', () => {
    // `ShopCourier` est un rôle de boutique par construction (§3.1), mais un
    // livreur exerce sur toute la plateforme : ses missions et ses revenus ne
    // sont rattachés à aucune route `/shop/:shopId/...`. Découvert en
    // exécutant l'application : sans ce cas, AUCUN livreur ne peut jamais
    // consulter ses propres revenus ou missions (§4.2).
    const courierOfA: AuthenticatedUser = {
      id: 'u4',
      mysqlId: 4,
      phone: '+261340000005',
      roles: [{ role: Role.Client }, { role: Role.ShopCourier, shopId: SHOP_A }],
    };

    it('accorde les revenus livreur sans qu’aucune boutique ne soit nommée par la route', () => {
      const guard = guardWith({ [PERMISSION_KEY]: Permission.CourierEarningsRead });
      expect(guard.canActivate(contextFor(courierOfA))).toBe(true);
    });

    it('accorde la mise à jour de livraison sans portée déclarée', () => {
      const guard = guardWith({ [PERMISSION_KEY]: Permission.DeliveryUpdate });
      expect(guard.canActivate(contextFor(courierOfA))).toBe(true);
    });

    it('ne dispense PAS les autres permissions du même rôle de leur portée boutique', () => {
      // La liste est volontairement restreinte : élargir `PaymentCollect`
      // romprait exactement la faille que ce garde corrige.
      const guard = guardWith({ [PERMISSION_KEY]: Permission.PaymentCollect });
      expect(() => guard.canActivate(contextFor(courierOfA))).toThrow(ForbiddenException);
    });
  });

  it('permet le cumul de rôles dans plusieurs boutiques', () => {
    // Impossible sur le web : `shop_team_members.user_id` est en contrainte UNIQUE.
    const polyvalent: AuthenticatedUser = {
      id: 'u3',
      mysqlId: 3,
      phone: '+261340000004',
      roles: [
        { role: Role.ShopCashier, shopId: SHOP_A },
        { role: Role.ShopStock, shopId: SHOP_B },
      ],
    };

    const collect = guardWith({
      [PERMISSION_KEY]: Permission.PaymentCollect,
      [SCOPE_PARAM_KEY]: 'shopId',
    });
    const move = guardWith({
      [PERMISSION_KEY]: Permission.StockMove,
      [SCOPE_PARAM_KEY]: 'shopId',
    });

    expect(collect.canActivate(contextFor(polyvalent, { shopId: SHOP_A }))).toBe(true);
    expect(move.canActivate(contextFor(polyvalent, { shopId: SHOP_B }))).toBe(true);

    // …mais chaque rôle reste cantonné à sa boutique.
    expect(() => collect.canActivate(contextFor(polyvalent, { shopId: SHOP_B }))).toThrow(
      ForbiddenException,
    );
  });

  it('refuse toute requête sans utilisateur authentifié', () => {
    const guard = guardWith({ [PERMISSION_KEY]: Permission.OrderCreate });
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
