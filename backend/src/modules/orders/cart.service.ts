import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { GeoService } from '../geo/geo.service';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import { Cart, type CartDocument } from './schemas/cart.schema';
import { Coupon, type CouponDocument } from './schemas/coupon.schema';
import type { DeliveryDto } from './dto/create-order.dto';
import { evaluateCoupon } from './utils/evaluate-coupon';
import { groupByShop } from './utils/group-by-shop';

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private readonly carts: Model<CartDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    private readonly geo: GeoService,
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

  /** Vide le panier — même mise à jour que celle appliquée après création de commande. */
  async clear(userId: string): Promise<void> {
    await this.carts.updateOne({ _id: userId }, { $set: { items: [] } });
  }

  /**
   * Aperçu du panier avant confirmation — « vérifier les produits » et
   * « vérifier le total » du cahier des charges, en une seule route.
   *
   * Lecture pure : aucune écriture, aucun stock touché, aucune commande
   * créée. Relit prix/stock ACTUELS (jamais l'instantané du panier — même
   * principe que `OrdersService.consumeStock`), pour signaler les lignes
   * devenues indisponibles ou dont le prix a changé avant que le client ne
   * confirme — `POST /orders` revalidera intégralement de toute façon.
   */
  async preview(
    userId: string,
    delivery: Pick<DeliveryDto, 'method' | 'location'>,
    couponCode?: string,
  ): Promise<unknown> {
    const cart = await this.carts.findById(userId).lean();
    const items = cart?.items ?? [];
    if (items.length === 0) return { shops: [], grandTotal: 0 };

    const shopsOut: unknown[] = [];
    let grandTotal = 0;

    for (const [shopId, groupItems] of groupByShop(items)) {
      let subtotal = 0;
      const lineResults = [];

      for (const item of groupItems) {
        const product = await this.products.findById(item.productId).lean();
        const published = !!product && product.status === 'published';
        const available = published && product.stock >= item.quantity;
        const currentPrice = published
          ? Number(String(product.promoPrice ?? product.price))
          : Number(String(item.snapshot.price));
        const priceChanged = published && currentPrice !== Number(String(item.snapshot.price));
        const lineSubtotal = currentPrice * item.quantity;
        if (available) subtotal += lineSubtotal;

        lineResults.push({
          productId: String(item.productId),
          name: item.snapshot.name,
          image: item.snapshot.image,
          quantity: item.quantity,
          unitPrice: currentPrice,
          subtotal: lineSubtotal,
          available,
          priceChanged,
          stockRemaining: published ? product.stock : 0,
        });
      }

      let shippingFee = 0;
      let shippingEstimated = false;
      if (delivery.method === 'delivery') {
        const shop = await this.shops.findById(shopId).select('location').lean();
        if (shop?.location && delivery.location) {
          shippingFee = this.geo.computeDeliveryFee(shop.location, delivery.location).fee;
        } else {
          // Adresse non géolocalisable (courant pour une adresse informelle à
          // Mahajanga) : repli sur le forfait seul, signalé au client plutôt
          // que présenté comme un montant exact.
          shippingFee = this.geo.baseDeliveryFee;
          shippingEstimated = true;
        }
      }

      let couponResult:
        { code: string; valid: boolean; reason?: string; discountAmount: number } | undefined;
      if (couponCode) {
        const coupon = await this.coupons.findOne({ code: couponCode.toUpperCase() }).lean();
        const evaluation = evaluateCoupon(coupon, shopId, subtotal);
        couponResult = {
          code: couponCode.toUpperCase(),
          valid: evaluation.valid,
          reason: evaluation.reason,
          discountAmount: evaluation.discount,
        };
      }

      const discount = couponResult?.valid ? couponResult.discountAmount : 0;
      const total = subtotal + shippingFee - discount;
      grandTotal += total;

      shopsOut.push({
        shopId,
        shopName: groupItems[0].snapshot.shopName,
        items: lineResults,
        subtotal,
        shippingFee,
        shippingEstimated,
        discount,
        total,
        coupon: couponResult,
      });
    }

    return { shops: shopsOut, grandTotal };
  }
}
