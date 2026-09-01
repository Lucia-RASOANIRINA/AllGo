import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import { Follow, type FollowDocument } from './schemas/interactions.schema';

/**
 * Abonnement à une boutique — c'est le mécanisme qui alimente
 * `Shop.stats.followerCount` (§ fiche boutique). Le modèle `Follow` est
 * générique (`targetType: 'user'|'shop'`), mais seule la cible boutique est
 * exposée ici : suivre un autre utilisateur n'est demandé nulle part côté
 * client.
 */
@Injectable()
export class FollowsService {
  constructor(
    @InjectModel(Follow.name) private readonly follows: Model<FollowDocument>,
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
  ) {}

  /** Ajout idempotent — upsert sur l'index unique, même motif que les favoris. */
  async followShop(userId: string, shopId: string): Promise<{ following: true }> {
    const result = await this.follows.updateOne(
      {
        followerId: new Types.ObjectId(userId),
        targetType: 'shop',
        targetId: new Types.ObjectId(shopId),
      },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    // `upsertedCount` : n'incrémente le compteur qu'à la création réelle, pas
    // à un appel répété (idempotence — §9.3, actions différées rejouées).
    if (result.upsertedCount > 0) {
      await this.shops.updateOne({ _id: shopId }, { $inc: { 'stats.followerCount': 1 } });
    }
    return { following: true };
  }

  async unfollowShop(userId: string, shopId: string): Promise<{ following: false }> {
    const result = await this.follows.deleteOne({
      followerId: new Types.ObjectId(userId),
      targetType: 'shop',
      targetId: new Types.ObjectId(shopId),
    });
    if (result.deletedCount > 0) {
      await this.shops.updateOne(
        { _id: shopId, 'stats.followerCount': { $gt: 0 } },
        { $inc: { 'stats.followerCount': -1 } },
      );
    }
    return { following: false };
  }

  /** Identifiants seuls — colore les boutons « Suivre » sans transporter de fiches. */
  async followedShopIds(userId: string): Promise<string[]> {
    const rows = await this.follows
      .find({ followerId: new Types.ObjectId(userId), targetType: 'shop' })
      .select('targetId')
      .lean();

    return rows.map((row) => String(row.targetId));
  }

  /**
   * Liste enrichie des boutiques suivies — même motif que
   * `FavoritesService.list` : les abonnements sont lus d'abord, puis les
   * boutiques en une seule requête `$in`.
   */
  async listFollowedShops(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = {
      followerId: new Types.ObjectId(userId),
      targetType: 'shop',
    };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const rows = await this.follows
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const shops = await this.shops
      .find({ _id: { $in: page.map((row) => row.targetId) } })
      .select('slug name logo address stats')
      .lean();

    const byId = new Map(shops.map((s) => [String(s._id), s]));
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
}
