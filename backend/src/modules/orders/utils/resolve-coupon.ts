import { ClientSession, Model } from 'mongoose';

import type { CouponDocument } from '../schemas/coupon.schema';
import type { PromotionDocument } from '../../campaigns/schemas/promotion.schema';
import type { CouponLike } from './evaluate-coupon';

export type ResolvedCoupon = CouponLike & { source: 'coupon' | 'promotion'; refId: string };

/**
 * Un code promo vient de deux origines possibles : la collection `coupons`
 * (générique, créée à la main — §9) ou le champ `couponCode` d'une
 * `Promotion` commerçant (§21, créée depuis l'espace commerçant). Les deux
 * sont normalisées vers `CouponLike` pour qu'`evaluateCoupon` les traite
 * identiquement, sans dupliquer la logique de calcul entre elles.
 */
export async function resolveCouponByCode(
  coupons: Model<CouponDocument>,
  promotions: Model<PromotionDocument>,
  code: string,
  session?: ClientSession,
): Promise<ResolvedCoupon | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;

  const coupon = await coupons.findOne({ code: normalized }).session(session ?? null);
  if (coupon) {
    return {
      source: 'coupon',
      refId: String(coupon._id),
      shopId: coupon.shopId,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minOrderAmount: coupon.minOrderAmount,
      maxDiscount: coupon.maxDiscount,
      expiresAt: coupon.expiresAt,
      usageLimit: coupon.usageLimit,
      usageCount: coupon.usageCount,
      active: coupon.active,
    };
  }

  // Repli : un code promo porté par une promotion commerçant. Le type `price`
  // (prix fixé sur la fiche produit) n'a pas de sens comme réduction de
  // panier — seuls `percent` et `fixed` sont éligibles ici.
  const promotion = await promotions
    .findOne({
      couponCode: normalized,
      active: true,
      type: { $in: ['percent', 'fixed'] },
      startsAt: { $lte: new Date() },
    })
    .session(session ?? null);
  if (!promotion) return null;

  return {
    source: 'promotion',
    refId: String(promotion._id),
    shopId: promotion.shopId,
    discountType: promotion.type as 'percent' | 'fixed',
    discountValue: promotion.value,
    expiresAt: promotion.endsAt,
    usageLimit: promotion.quantityLimit,
    usageCount: promotion.redeemedCount ?? 0,
    active: promotion.active,
  };
}

/**
 * Incrémente l'usage après une commande créée avec succès — jamais avant,
 * sinon une transaction annulée aurait tout de même consommé une utilisation.
 */
export async function markCouponRedeemed(
  coupons: Model<CouponDocument>,
  promotions: Model<PromotionDocument>,
  resolved: ResolvedCoupon,
  session?: ClientSession,
): Promise<void> {
  if (resolved.source === 'coupon') {
    await coupons.updateOne(
      { _id: resolved.refId },
      { $inc: { usageCount: 1 } },
      { session },
    );
  } else {
    await promotions.updateOne(
      { _id: resolved.refId },
      { $inc: { redeemedCount: 1 } },
      { session },
    );
  }
}
