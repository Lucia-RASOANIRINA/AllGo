import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import { Promotion, type PromotionDocument } from '../campaigns/schemas/promotion.schema';
import { Post, type PostDocument } from './schemas/post.schema';
import { Favorite, type FavoriteDocument, type FavoriteTargetType } from './schemas/interactions.schema';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectModel(Favorite.name) private readonly favorites: Model<FavoriteDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(Promotion.name) private readonly promotions: Model<PromotionDocument>,
    @InjectModel(Post.name) private readonly posts: Model<PostDocument>,
  ) {}

  /**
   * Ajout idempotent.
   *
   * `upsert` sur l'index unique `{ userId, targetType, targetId }` : un double
   * appui, ou une action différée rejouée à la reconnexion (§9.3), ne crée
   * jamais de doublon. C'est la base qui l'interdit, pas une vérification
   * préalable qui laisserait une fenêtre de concurrence.
   */
  async add(userId: string, targetType: FavoriteTargetType, targetId: string): Promise<{ favorited: true }> {
    await this.favorites.updateOne(
      { userId: new Types.ObjectId(userId), targetType, targetId: new Types.ObjectId(targetId) },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    return { favorited: true };
  }

  async remove(userId: string, targetType: FavoriteTargetType, targetId: string): Promise<{ favorited: false }> {
    await this.favorites.deleteOne({
      userId: new Types.ObjectId(userId),
      targetType,
      targetId: new Types.ObjectId(targetId),
    });
    return { favorited: false };
  }

  /** Identifiants seuls — quelques centaines d'octets au lieu de plusieurs kilo-octets. */
  async ids(userId: string, targetType: FavoriteTargetType): Promise<string[]> {
    const rows = await this.favorites
      .find({ userId: new Types.ObjectId(userId), targetType })
      .select('targetId')
      .lean();

    return rows.map((row) => String(row.targetId));
  }

  /**
   * Liste enrichie, un type de cible à la fois.
   *
   * Les favoris sont lus d'abord, puis les documents en une seule requête
   * `$in` sur la collection correspondante : un `$lookup` à chaque lecture
   * signalerait un découpage inadapté (§6.5), et la pagination porte de toute
   * façon sur les favoris, jamais sur les cibles.
   */
  async list(
    userId: string,
    targetType: FavoriteTargetType,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId), targetType };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const rows = await this.favorites
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const byId = await this.enrich(targetType, page.map((row) => row.targetId));
    // L'ordre des favoris (du plus récent au plus ancien) prime sur celui que
    // MongoDB renvoie pour le `$in`, qui n'est pas garanti.
    const items = page.map((row) => byId.get(String(row.targetId))).filter(Boolean);

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

  private async enrich(
    targetType: FavoriteTargetType,
    ids: Types.ObjectId[],
  ): Promise<Map<string, unknown>> {
    switch (targetType) {
      case 'product': {
        const docs = await this.products
          .find({ _id: { $in: ids } })
          .select('name price promoPrice currency media stock shop shopId status')
          .lean();
        return new Map(docs.map((d) => [String(d._id), d]));
      }
      case 'shop': {
        const docs = await this.shops
          .find({ _id: { $in: ids } })
          .select('slug name logo address stats status')
          .lean();
        return new Map(docs.map((d) => [String(d._id), d]));
      }
      case 'promotion': {
        const docs = await this.promotions.find({ _id: { $in: ids } }).lean();
        return new Map(docs.map((d) => [String(d._id), d]));
      }
      case 'post': {
        const docs = await this.posts.find({ _id: { $in: ids } }).lean();
        return new Map(docs.map((d) => [String(d._id), d]));
      }
    }
  }
}
