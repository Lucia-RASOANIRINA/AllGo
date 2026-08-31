/**
 * Évaluation pure d'un coupon — partagée entre `OrdersService.applyCoupon`
 * (qui incrémente ensuite `usageCount` de façon atomique) et
 * `CartService.preview` (lecture seule, ne doit RIEN muter). Isoler le calcul
 * ici évite que les deux services dérivent l'un de l'autre.
 */

export interface CouponLike {
  shopId?: unknown;
  discountType: 'percent' | 'fixed';
  discountValue: unknown;
  minOrderAmount?: unknown;
  maxDiscount?: unknown;
  expiresAt?: Date;
  usageLimit?: number;
  usageCount: number;
  active: boolean;
}

export type CouponRejectionReason =
  'NOT_FOUND' | 'EXPIRED' | 'LIMIT_REACHED' | 'NOT_APPLICABLE' | 'MIN_AMOUNT';

export interface CouponEvaluation {
  valid: boolean;
  reason?: CouponRejectionReason;
  discount: number;
}

/**
 * `NOT_APPLICABLE` (mauvaise boutique) et `MIN_AMOUNT` (sous-total
 * insuffisant) sont propres à UNE commande d'un panier qui peut en produire
 * plusieurs : ne doivent jamais faire échouer les autres. `NOT_FOUND`,
 * `EXPIRED` et `LIMIT_REACHED` sont des états globaux du code et justifient un
 * refus complet — la distinction est faite par l'appelant (`OrdersService`),
 * pas ici : cette fonction se contente d'évaluer, jamais de décider quoi
 * annuler.
 */
export function evaluateCoupon(
  coupon: CouponLike | null,
  shopId: string,
  subtotal: number,
): CouponEvaluation {
  if (!coupon || !coupon.active) return { valid: false, reason: 'NOT_FOUND', discount: 0 };
  if (coupon.expiresAt && coupon.expiresAt < new Date()) {
    return { valid: false, reason: 'EXPIRED', discount: 0 };
  }
  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
    return { valid: false, reason: 'LIMIT_REACHED', discount: 0 };
  }
  if (coupon.shopId && String(coupon.shopId) !== shopId) {
    return { valid: false, reason: 'NOT_APPLICABLE', discount: 0 };
  }

  const minOrderAmount = coupon.minOrderAmount ? Number(String(coupon.minOrderAmount)) : 0;
  if (subtotal < minOrderAmount) return { valid: false, reason: 'MIN_AMOUNT', discount: 0 };

  const discountValue = Number(String(coupon.discountValue));
  let discount =
    coupon.discountType === 'percent' ? (subtotal * discountValue) / 100 : discountValue;
  if (coupon.maxDiscount) discount = Math.min(discount, Number(String(coupon.maxDiscount)));
  discount = Math.round(Math.min(discount, subtotal));

  return { valid: true, discount };
}
