import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { Category, type CategoryDocument } from '../catalog/schemas/category.schema';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Order, type OrderDocument } from '../orders/schemas/order.schema';

/** Plafond par collection et par appel — évite une réponse de plusieurs mégaoctets. */
const MAX_PER_COLLECTION = 500;

@Injectable()
export class SyncService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Category.name) private readonly categories: Model<CategoryDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
  ) {}

  /**
   * Delta de synchronisation — §9.5.
   *
   * `serverTime` est renvoyé pour que le client l'utilise comme `since` au
   * prochain appel : se fier à l'horloge du téléphone ferait perdre des
   * documents dès qu'elle dérive de quelques secondes.
   *
   * `truncated` signale une collection plafonnée : le client doit rappeler
   * immédiatement plutôt que de croire sa synchronisation terminée.
   */
  async changesSince(
    user: AuthenticatedUser,
    since?: Date,
    collections?: string[],
  ): Promise<Record<string, unknown>> {
    const serverTime = new Date();
    const wanted = new Set(collections ?? ['products', 'categories', 'orders']);
    const filter = since ? { updatedAt: { $gt: since } } : {};
    const result: Record<string, unknown> = { serverTime, truncated: [] as string[] };
    const truncated: string[] = [];

    if (wanted.has('categories')) {
      result.categories = await this.categories
        .find(filter)
        .sort({ updatedAt: 1 })
        .limit(MAX_PER_COLLECTION)
        .lean();
    }

    if (wanted.has('products')) {
      const docs = await this.products
        .find({ ...filter, status: 'published' })
        .sort({ updatedAt: 1 })
        .limit(MAX_PER_COLLECTION)
        .lean();
      if (docs.length === MAX_PER_COLLECTION) truncated.push('products');
      result.products = docs;
    }

    if (wanted.has('orders')) {
      result.orders = await this.orders
        .find({ ...filter, userId: new Types.ObjectId(user.id) })
        .sort({ updatedAt: 1 })
        .limit(MAX_PER_COLLECTION)
        .lean();
    }

    result.truncated = truncated;
    return result;
  }
}
