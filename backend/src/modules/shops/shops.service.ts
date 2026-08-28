import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { openNowFilter } from '../../common/time/open-now';
import { Review, type ReviewDocument } from './schemas/review.schema';
import { Shop, type ShopDocument } from './schemas/shop.schema';

export interface ShopQuery {
  limit: number;
  cursor?: string;
  q?: string;
  sort?: 'new' | 'popular';
  categoryId?: string;
  delivery?: boolean;
  pickup?: boolean;
  openNow?: boolean;
  minRating?: number;
}

@Injectable()
export class ShopsService {
  constructor(
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
  ) {}

  async list(query: ShopQuery): Promise<Paginated<unknown>> {
    // Seules les boutiques validées sont publiques : la modération reste sur le
    // back-office web (§2.1), mais son verdict est opposable ici.
    const filter: Record<string, unknown> = { status: 'approved' };
    if (query.q) filter.$text = { $search: query.q };
    if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
    // Boutiques déjà en base, sans le champ `fulfillment` : livraison
    // implicite (c'était le seul mode possible jusqu'ici) — `$ne: false`
    // les inclut, contrairement à `true` qui les exclurait à tort.
    if (query.delivery) filter['fulfillment.delivery'] = { $ne: false };
    if (query.pickup) filter['fulfillment.pickup'] = true;
    if (query.minRating !== undefined) filter['stats.rating'] = { $gte: query.minRating };
    if (query.openNow) Object.assign(filter, openNowFilter());

    // Popularité = nombre d'abonnés (`stats.followerCount`). Utilisé pour un
    // carrousel borné (page d'accueil), comme le tri équivalent du catalogue.
    const sortField = query.sort === 'popular' ? 'stats.followerCount' : 'createdAt';

    if (query.cursor) {
      Object.assign(filter, cursorFilter(sortField, decodeCursor(query.cursor)));
    }

    const docs = await this.shops
      .find(filter, this.listProjection())
      .sort({ [sortField]: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean();

    const hasMore = docs.length > query.limit;
    const items = hasMore ? docs.slice(0, query.limit) : docs;
    const last = items[items.length - 1] as Record<string, unknown> | undefined;

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              value:
                sortField === 'createdAt'
                  ? (last.createdAt as Date).toISOString()
                  : (((last.stats as Record<string, unknown> | undefined)?.followerCount as
                      number | undefined) ?? 0),
              id: String(last._id),
            })
          : null,
    };
  }

  /**
   * Projection de la liste — une carte de boutique n'a besoin ni de l'équipe,
   * ni des horaires, ni de la description complète (§7.1, même principe que
   * `CatalogService.projection`). Le détail complet reste sur `/shops/:slug`.
   */
  private listProjection(): Record<string, 1> {
    return {
      name: 1,
      slug: 1,
      logo: 1,
      categoryId: 1,
      categoryName: 1,
      'address.city': 1,
      isFeatured: 1,
      fulfillment: 1,
      stats: 1,
      createdAt: 1,
    };
  }

  async findBySlug(slug: string): Promise<unknown> {
    const shop = await this.shops.findOne({ slug, status: 'approved' }).lean();
    if (!shop) throw AppError.notFound('Boutique');
    return shop;
  }

  /**
   * Tableau de bord d'une boutique.
   * TODO(L5) : agrégats du jour — chiffre d'affaires, commandes par statut,
   * alertes de stock, top produits.
   */
  async dashboard(shopId: string): Promise<unknown> {
    const shop = await this.shops.findById(shopId).lean();
    if (!shop) throw AppError.notFound('Boutique');
    return { shopId: String(shop._id), stats: shop.stats, team: shop.team.length };
  }

  /** Membres d'équipe — un utilisateur peut appartenir à plusieurs boutiques (§3.1). */
  async team(shopId: string): Promise<unknown[]> {
    const shop = await this.shops.findById(shopId).select('team').lean();
    if (!shop) throw AppError.notFound('Boutique');
    return shop.team;
  }

  /** Boutiques où l'utilisateur détient un rôle — alimente le sélecteur de profil (§11.2). */
  async myShops(userId: string): Promise<unknown[]> {
    return this.shops
      .find({ 'team.userId': new Types.ObjectId(userId) })
      .select('name slug logo status stats')
      .lean();
  }

  /** Avis d'une boutique, paginés par curseur — même motif que le catalogue. */
  async listReviews(shopId: string, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { shopId: new Types.ObjectId(shopId) };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const docs = await this.reviews
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;
    const last = items[items.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: String(last._id) })
          : null,
    };
  }

  /**
   * Dépose ou remplace mon avis (upsert sur l'index unique `{shopId, userId}`)
   * — un client ne peut avoir qu'un avis par boutique, la déposer à nouveau la
   * met simplement à jour plutôt que d'en créer un doublon.
   */
  async upsertReview(
    shopId: string,
    userId: string,
    author: { name: string; avatar?: string },
    rating: number,
    comment: string | undefined,
  ): Promise<unknown> {
    const shop = await this.shops.findById(shopId).select('_id').lean();
    if (!shop) throw AppError.notFound('Boutique');

    await this.reviews.updateOne(
      { shopId: new Types.ObjectId(shopId), userId: new Types.ObjectId(userId) },
      { $set: { author, rating, comment, createdAt: new Date() } },
      { upsert: true },
    );
    await this.recomputeReviewStats(shopId);

    return this.reviews
      .findOne({ shopId: new Types.ObjectId(shopId), userId: new Types.ObjectId(userId) })
      .lean();
  }

  async removeOwnReview(shopId: string, userId: string): Promise<void> {
    await this.reviews.deleteOne({
      shopId: new Types.ObjectId(shopId),
      userId: new Types.ObjectId(userId),
    });
    await this.recomputeReviewStats(shopId);
  }

  /**
   * Recalcule `stats.rating`/`stats.reviewCount` par agrégation complète.
   * Le volume par boutique reste faible à cette échelle : un recalcul entier
   * est largement suffisant, pas besoin d'un compteur incrémental fragile.
   */
  private async recomputeReviewStats(shopId: string): Promise<void> {
    const [agg] = await this.reviews.aggregate<{ avgRating: number; count: number }>([
      { $match: { shopId: new Types.ObjectId(shopId) } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    await this.shops.updateOne(
      { _id: shopId },
      {
        $set: {
          'stats.rating': agg ? Math.round(agg.avgRating * 10) / 10 : 0,
          'stats.reviewCount': agg?.count ?? 0,
        },
      },
    );
  }
}
