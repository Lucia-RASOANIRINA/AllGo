import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
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

/**
 * Boutiques ouvertes maintenant, sur un décalage fixe UTC+3 (Madagascar, pas
 * de changement d'heure) — l'application ne cible qu'une seule ville
 * (Mahajanga), déjà assumé ailleurs (repli géographique codé en dur).
 * Comparaison de chaînes `HH:mm` zéro-paddées : valide pour du 24 h.
 */
function openNowFilter(): Record<string, unknown> {
  const utcPlus3 = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const isoDay = utcPlus3.getUTCDay() === 0 ? 7 : utcPlus3.getUTCDay();
  const hhmm =
    String(utcPlus3.getUTCHours()).padStart(2, '0') +
    ':' +
    String(utcPlus3.getUTCMinutes()).padStart(2, '0');

  return {
    openingHours: { $elemMatch: { day: isoDay, open: { $lte: hhmm }, close: { $gte: hhmm } } },
  };
}

@Injectable()
export class ShopsService {
  constructor(@InjectModel(Shop.name) private readonly shops: Model<ShopDocument>) {}

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
}
