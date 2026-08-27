import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Favorite, type FavoriteDocument } from './schemas/interactions.schema';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(Favorite.name) private readonly favorites: Model<FavoriteDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
  ) {}

  /**
   * Ajout idempotent.
   *
   * `upsert` sur l'index unique `{ userId, productId }` : un double appui, ou
   * une action différée rejouée à la reconnexion (§9.3), ne crée jamais de
   * doublon. C'est la base qui l'interdit, pas une vérification préalable qui
   * laisserait une fenêtre de concurrence.
   */
  async add(userId: string, productId: string): Promise<{ favorited: true }> {
    await this.favorites.updateOne(
      { userId: new Types.ObjectId(userId), productId: new Types.ObjectId(productId) },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    return { favorited: true };
  }

  async remove(userId: string, productId: string): Promise<{ favorited: false }> {
    await this.favorites.deleteOne({
      userId: new Types.ObjectId(userId),
      productId: new Types.ObjectId(productId),
    });
    return { favorited: false };
  }

  /** Identifiants seuls — quelques centaines d'octets au lieu de plusieurs kilo-octets. */
  async productIds(userId: string): Promise<string[]> {
    const rows = await this.favorites
      .find({ userId: new Types.ObjectId(userId) })
      .select('productId')
      .lean();

    return rows.map((row) => String(row.productId));
  }

  /**
   * Liste enrichie des fiches produit.
   *
   * Les favoris sont lus d'abord, puis les produits en une seule requête `$in` :
   * un `$lookup` à chaque lecture signalerait un découpage inadapté (§6.5), et
   * la pagination porte de toute façon sur les favoris, pas sur les produits.
   */
  async list(userId: string, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const rows = await this.favorites
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const products = await this.products
      .find({ _id: { $in: page.map((row) => row.productId) } })
      .select('name price promoPrice currency media stock shop shopId status')
      .lean();

    // L'ordre des favoris (du plus récent au plus ancien) prime sur celui que
    // MongoDB renvoie pour le `$in`, qui n'est pas garanti.
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const items = page.map((row) => byId.get(String(row.productId))).filter(Boolean);

    const last = page[page.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: String(last._id) })
          : null,
    };
  }
}
