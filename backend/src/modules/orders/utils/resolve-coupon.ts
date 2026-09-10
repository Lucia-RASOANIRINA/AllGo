import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { CouponLike } from './evaluate-coupon';

export type ResolvedCoupon = CouponLike & { source: 'coupon' | 'promotion'; refId: string };

/**
 * Un code promo vient de deux origines possibles : la vraie table `coupons`
 * (générique, créée à la main) ou le champ `coupon_code` d'une `promotions`
 * commerçant (les deux tables réelles MySQL depuis la Phase 4). Normalisées
 * ici vers `CouponLike` pour qu'`evaluateCoupon` les traite identiquement.
 */
export async function resolveCouponByCode(
  prisma: PrismaService,
  code: string,
): Promise<ResolvedCoupon | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;

  const coupon = await prisma.coupons.findUnique({ where: { code: normalized } });
  if (coupon) {
    return {
      source: 'coupon',
      refId: String(coupon.id),
      shopId: coupon.shop_id ? String(coupon.shop_id) : undefined,
      discountType: coupon.discount_type ?? 'percent',
      discountValue: coupon.discount_value,
      expiresAt: coupon.expires_at,
      usageLimit: coupon.usage_limit ?? undefined,
      usageCount: coupon.used_count ?? 0,
      // Pas de colonne `active` côté table `coupons` (§ décision Phase 3) : un
      // coupon existant est actif tant qu'il n'est ni expiré ni épuisé.
      active: true,
    };
  }

  // Repli : un code promo porté par une promotion commerçant. Le type `price`
  // (prix fixé sur la fiche produit) n'a pas de sens comme réduction de
  // panier — seuls `percent` et `fixed` sont éligibles ici.
  const promotion = await prisma.promotions.findFirst({
    where: {
      coupon_code: normalized,
      active: true,
      type: { in: ['percent', 'fixed'] },
      starts_at: { lte: new Date() },
    },
  });
  if (!promotion) return null;

  return {
    source: 'promotion',
    refId: String(promotion.id),
    shopId: String(promotion.shop_id),
    discountType: promotion.type as 'percent' | 'fixed',
    discountValue: promotion.value,
    expiresAt: promotion.ends_at,
    usageLimit: promotion.quantity_limit ?? undefined,
    usageCount: promotion.redeemed_count,
    active: promotion.active,
  };
}

/**
 * Incrémente l'usage après une commande créée avec succès — jamais avant,
 * sinon une transaction annulée aurait tout de même consommé une utilisation.
 */
export async function markCouponRedeemed(prisma: PrismaService, resolved: ResolvedCoupon): Promise<void> {
  if (resolved.source === 'coupon') {
    await prisma.coupons.update({ where: { id: Number(resolved.refId) }, data: { used_count: { increment: 1 } } });
  } else {
    await prisma.promotions.update({ where: { id: Number(resolved.refId) }, data: { redeemed_count: { increment: 1 } } });
  }
}
