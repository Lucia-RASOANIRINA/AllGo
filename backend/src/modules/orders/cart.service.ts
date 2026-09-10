import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { evaluateCoupon } from './utils/evaluate-coupon';
import { resolveCouponByCode } from './utils/resolve-coupon';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async get(userId: number): Promise<unknown> {
    const rows = await this.prisma.cart.findMany({
      where: { user_id: userId },
      orderBy: { id: 'asc' },
      include: {
        products: { include: { shops: { select: { name: true } }, product_images: true } },
        product_variants: true,
      },
    });
    return { items: rows.map((row) => this.toJson(row)) };
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
    userId: number,
    productId: string,
    quantity: number,
    variantId?: string,
  ): Promise<unknown> {
    const numericId = Number(productId);
    const numericVariantId = variantId ? Number(variantId) : null;
    const product = await this.prisma.products.findUnique({ where: { id: numericId } });
    if (!product || product.status !== 'published') {
      throw new AppError('PRODUCT_UNAVAILABLE', "Ce produit n'est plus disponible.", 409);
    }
    if ((product.stock ?? 0) < quantity) {
      throw AppError.insufficientStock(product.name, product.stock ?? 0, quantity);
    }

    // Même produit (même variante) déjà présent : on incrémente plutôt que
    // d'ajouter une ligne — aucune contrainte d'unicité côté table réelle,
    // c'est donc au service de l'appliquer.
    const existing = await this.prisma.cart.findFirst({
      where: { user_id: userId, product_id: numericId, variant_id: numericVariantId },
    });
    if (existing) {
      await this.prisma.cart.update({ where: { id: existing.id }, data: { quantity: existing.quantity + quantity } });
    } else {
      await this.prisma.cart.create({
        data: { user_id: userId, product_id: numericId, variant_id: numericVariantId, quantity },
      });
    }

    return this.get(userId);
  }

  async updateQuantity(userId: number, itemId: string, quantity: number): Promise<unknown> {
    if (quantity < 1) return this.removeItem(userId, itemId);
    await this.prisma.cart.updateMany({ where: { id: Number(itemId), user_id: userId }, data: { quantity } });
    return this.get(userId);
  }

  async removeItem(userId: number, itemId: string): Promise<unknown> {
    await this.prisma.cart.deleteMany({ where: { id: Number(itemId), user_id: userId } });
    return this.get(userId);
  }

  /**
   * Prévisualisation d'un code promo avant commande — lecture seule, ne mute
   * ni le compteur d'usage ni le panier. Le panier pouvant couvrir plusieurs
   * boutiques, la réduction est calculée boutique par boutique : un code
   * restreint à une seule boutique n'invalide pas les autres lignes.
   */
  async previewCoupon(userId: number, code: string): Promise<unknown> {
    const rows = await this.prisma.cart.findMany({
      where: { user_id: userId },
      include: { products: { include: { shops: { select: { name: true } } } } },
    });
    if (rows.length === 0) {
      throw new AppError('CART_EMPTY', 'Votre panier est vide.', 400);
    }

    const resolved = await resolveCouponByCode(this.prisma, code);
    if (!resolved) throw new AppError('COUPON_INVALID', 'Ce code promo est introuvable.', 400);

    const byShop = new Map<string, { shopId: string; shopName: string; subtotal: number }>();
    for (const row of rows) {
      const shopId = String(row.products.shop_id);
      const unitPrice = Number(row.products.promo_price ?? row.products.price);
      const entry = byShop.get(shopId) ?? { shopId, shopName: row.products.shops.name, subtotal: 0 };
      entry.subtotal += unitPrice * row.quantity;
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

  private toJson(row: {
    id: number;
    product_id: number;
    variant_id: number | null;
    quantity: number;
    products: {
      name: string;
      price: unknown;
      promo_price: unknown;
      shop_id: number;
      shops: { name: string };
      product_images: { image_path: string; is_main: boolean | null }[];
    };
  }): unknown {
    const mainImage = row.products.product_images.find((m) => m.is_main) ?? row.products.product_images[0];
    return {
      id: String(row.id),
      productId: String(row.product_id),
      variantId: row.variant_id ? String(row.variant_id) : undefined,
      quantity: row.quantity,
      snapshot: {
        name: row.products.name,
        image: mainImage ? this.media.publicUrls(mainImage.image_path).thumbUrl : undefined,
        price: row.products.promo_price ?? row.products.price,
        shopId: String(row.products.shop_id),
        shopName: row.products.shops.name,
      },
    };
  }
}
