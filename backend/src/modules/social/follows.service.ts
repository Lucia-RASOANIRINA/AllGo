import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

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
}
