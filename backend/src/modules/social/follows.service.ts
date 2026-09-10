import { Injectable } from '@nestjs/common';

import type { Paginated } from '../../common/http/response.interceptor';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Abonnement à une boutique — table réelle `shop_followers` (déjà conçue pour
 * exactement cet usage, §48-tables audit). Contrairement à `follows` (Mongo,
 * générique `user`/`shop`), ceci écrit directement dans la vraie table plutôt
 * que de la laisser vide pendant qu'un miroir Mongo fait le travail : le tri
 * "populaires" de `ShopsService.list()` compte déjà sur `shop_followers`.
 */
@Injectable()
export class FollowsService {
  constructor(private readonly prisma: PrismaService) {}

  async followShop(userId: number, shopId: string): Promise<{ following: true }> {
    await this.prisma.shop_followers.upsert({
      where: { shop_id_user_id: { shop_id: Number(shopId), user_id: userId } },
      create: { shop_id: Number(shopId), user_id: userId },
      update: {},
    });
    return { following: true };
  }

  async unfollowShop(userId: number, shopId: string): Promise<{ following: false }> {
    await this.prisma.shop_followers.deleteMany({ where: { shop_id: Number(shopId), user_id: userId } });
    return { following: false };
  }

  /** Identifiants seuls — colore les boutons « Suivre » sans transporter de fiches. */
  async followedShopIds(userId: number): Promise<string[]> {
    const rows = await this.prisma.shop_followers.findMany({ where: { user_id: userId }, select: { shop_id: true } });
    return rows.map((row) => String(row.shop_id));
  }

  /**
   * Liste enrichie des boutiques suivies — pagination par curseur sur l'id
   * numérique, la clé la plus simple disponible côté MySQL.
   */
  async listFollowedShops(userId: number, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const rows = await this.prisma.shop_followers.findMany({
      where: { user_id: userId, ...(cursor ? { id: { lt: Number(cursor) } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { shops: true },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      items: page.map((row) => ({
        id: String(row.shops.id),
        slug: row.shops.slug,
        name: row.shops.name,
        logo: row.shops.logo ?? undefined,
        address: { city: row.shops.city ?? undefined },
      })),
      hasMore,
      nextCursor: hasMore && last ? String(last.id) : null,
    };
  }
}
