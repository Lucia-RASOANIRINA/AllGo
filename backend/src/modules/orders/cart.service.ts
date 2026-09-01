import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Cart, type CartDocument } from './schemas/cart.schema';
import { Coupon, type CouponDocument } from './schemas/coupon.schema';
import { Promotion, type PromotionDocument } from '../campaigns/schemas/promotion.schema';
import { evaluateCoupon } from './utils/evaluate-coupon';
import { resolveCouponByCode } from './utils/resolve-coupon';

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private readonly carts: Model<CartDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(Promotion.name) private readonly promotions: Model<PromotionDocument>,
  ) {}

  async get(userId: string): Promise<unknown> {
    const cart = await this.carts.findById(userId).lean();
    return cart ?? { _id: userId, items: [] };
  }

  /**
   * Ajout au panier.
   *
   * Le stock est vérifié pour informer l'utilisateur, mais n'est PAS réservé :
   * une réservation au panier immobiliserait un stock que personne n'achète.
   * La seule vérification qui engage est le décrément conditionnel de la
   * transaction de commande (§6.4).
   */
  async addItem(
    userId: string,
    productId: string,
    quantity: number,
    variantId?: string,
  ): Promise<unknown> {
    const product = await this.products.findById(productId).lean();
    if (!product || product.status !== 'published') {
      throw new AppError('PRODUCT_UNAVAILABLE', "Ce produit n'est plus disponible.", 409);
    }
    if (product.stock < quantity) {
      throw AppError.insufficientStock(product.name, product.stock, quantity);
    }

    const snapshot = {
      name: product.name,
      image: product.media.find((m) => m.isMain)?.thumbUrl ?? product.media[0]?.thumbUrl,
      price: product.promoPrice ?? product.price,
      shopId: product.shopId,
      shopName: product.shop.name,
    };

    // Même produit déjà présent : on incrémente plutôt que d'ajouter une ligne.
    const incremented = await this.carts.updateOne(
      { _id: userId, 'items.productId': new Types.ObjectId(productId) },
      { $inc: { 'items.$.quantity': quantity }, $set: { 'items.$.snapshot': snapshot } },
    );

    if (incremented.matchedCount === 0) {
      await this.carts.updateOne(
        { _id: userId },
        {
          $push: {
            items: {
              productId: new Types.ObjectId(productId),
              variantId: variantId ? new Types.ObjectId(variantId) : undefined,
              quantity,
              addedAt: new Date(),
              snapshot,
            },
          },
        },
        { upsert: true },
      );
    }

    return this.get(userId);
  }

  async updateQuantity(userId: string, itemId: string, quantity: number): Promise<unknown> {
    if (quantity < 1) return this.removeItem(userId, itemId);

    await this.carts.updateOne(
      { _id: userId, 'items._id': new Types.ObjectId(itemId) },
      { $set: { 'items.$.quantity': quantity } },
    );
    return this.get(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<unknown> {
    await this.carts.updateOne(
      { _id: userId },
      { $pull: { items: { _id: new Types.ObjectId(itemId) } } },
    );
    return this.get(userId);
  }

  /**
   * Prévisualisation d'un code promo avant commande — lecture seule, ne mute
   * ni le compteur d'usage ni le panier. Le panier pouvant couvrir plusieurs
   * boutiques, la réduction est calculée boutique par boutique : un code
   * restreint à une seule boutique n'invalide pas les autres lignes.
   */
  async previewCoupon(userId: string, code: string): Promise<unknown> {
    const cart = await this.carts.findById(userId).lean();
    if (!cart || cart.items.length === 0) {
      throw new AppError('CART_EMPTY', 'Votre panier est vide.', 400);
    }

    const resolved = await resolveCouponByCode(this.coupons, this.promotions, code);
    if (!resolved) throw new AppError('COUPON_INVALID', 'Ce code promo est introuvable.', 400);

    const byShop = new Map<string, { shopId: string; shopName: string; subtotal: number }>();
    for (const item of cart.items) {
      const shopId = String(item.snapshot.shopId);
      const entry = byShop.get(shopId) ?? { shopId, shopName: item.snapshot.shopName, subtotal: 0 };
      entry.subtotal += Number(String(item.snapshot.price)) * item.quantity;
      byShop.set(shopId, entry);
    }

    const shops = Array.from(byShop.values()).map((shop) => {
      const evaluation = evaluateCoupon(resolved, shop.shopId, shop.subtotal);
      return { ...shop, valid: evaluation.valid, reason: evaluation.reason, discount: evaluation.discount };
    });

    return {
      code: code.trim().toUpperCase(),
      shops,
      totalDiscount: shops.reduce((sum, shop) => sum + shop.discount, 0),
    };
  }
}
