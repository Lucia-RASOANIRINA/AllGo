import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Cart, type CartDocument } from './schemas/cart.schema';

@Injectable()
export class CartService {
  constructor(
    @InjectModel(Cart.name) private readonly carts: Model<CartDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
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
}
