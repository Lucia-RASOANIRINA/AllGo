import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { Shop, type ShopDocument } from './schemas/shop.schema';

@Injectable()
export class ShopsService {
  constructor(@InjectModel(Shop.name) private readonly shops: Model<ShopDocument>) {}

  async list(limit: number, cursor?: string, q?: string): Promise<Paginated<unknown>> {
    // Seules les boutiques validées sont publiques : la modération reste sur le
    // back-office web (§2.1), mais son verdict est opposable ici.
    const filter: Record<string, unknown> = { status: 'approved' };
    if (q) filter.$text = { $search: q };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const docs = await this.shops
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
