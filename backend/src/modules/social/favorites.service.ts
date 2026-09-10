import { Injectable } from '@nestjs/common';

import type { Paginated } from '../../common/http/response.interceptor';
import { decodeCursor, encodeCursor, prismaCursorFilter } from '../../common/pagination/cursor';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import type { FavoriteTargetType } from './schemas/interactions.schema';

/**
 * Favoris — quatre cibles, toutes des tables MySQL réelles depuis la Phase 4
 * (`favorites`/`shop_favorites`/`saved_promotions`/`saved_posts`) : plus de
 * collection Mongo générique `Favorite`, qu'aucune des quatre cibles
 * n'utilisait plus réellement une fois `product`/`shop` migrés en Phase 2 —
 * `promotion`/`post` continuaient d'y écrire faute d'alternative.
 */
@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /**
   * Ajout idempotent — `upsert` sur la contrainte unique de chaque table : un
   * double appui, ou une action différée rejouée à la reconnexion (§9.3), ne
   * crée jamais de doublon.
   */
  async add(userId: number, targetType: FavoriteTargetType, targetId: string): Promise<{ favorited: true }> {
    const id = Number(targetId);
    switch (targetType) {
      case 'product':
        await this.prisma.favorites.upsert({
          where: { user_id_product_id: { user_id: userId, product_id: id } },
          create: { user_id: userId, product_id: id },
          update: {},
        });
        break;
      case 'shop':
        await this.prisma.shop_favorites.upsert({
          where: { shop_id_user_id: { shop_id: id, user_id: userId } },
          create: { shop_id: id, user_id: userId },
          update: {},
        });
        break;
      case 'promotion':
        await this.prisma.saved_promotions.upsert({
          where: { promotion_id_user_id: { promotion_id: id, user_id: userId } },
          create: { promotion_id: id, user_id: userId },
          update: {},
        });
        break;
      case 'post':
        await this.prisma.saved_posts.upsert({
          where: { post_id_user_id: { post_id: id, user_id: userId } },
          create: { post_id: id, user_id: userId },
          update: {},
        });
        break;
    }
    return { favorited: true };
  }

  async remove(userId: number, targetType: FavoriteTargetType, targetId: string): Promise<{ favorited: false }> {
    const id = Number(targetId);
    switch (targetType) {
      case 'product':
        await this.prisma.favorites.deleteMany({ where: { user_id: userId, product_id: id } });
        break;
      case 'shop':
        await this.prisma.shop_favorites.deleteMany({ where: { shop_id: id, user_id: userId } });
        break;
      case 'promotion':
        await this.prisma.saved_promotions.deleteMany({ where: { promotion_id: id, user_id: userId } });
        break;
      case 'post':
        await this.prisma.saved_posts.deleteMany({ where: { post_id: id, user_id: userId } });
        break;
    }
    return { favorited: false };
  }

  /** Identifiants seuls — quelques centaines d'octets au lieu de plusieurs kilo-octets. */
  async ids(userId: number, targetType: FavoriteTargetType): Promise<string[]> {
    switch (targetType) {
      case 'product': {
        const rows = await this.prisma.favorites.findMany({ where: { user_id: userId }, select: { product_id: true } });
        return rows.map((r) => String(r.product_id));
      }
      case 'shop': {
        const rows = await this.prisma.shop_favorites.findMany({ where: { user_id: userId }, select: { shop_id: true } });
        return rows.map((r) => String(r.shop_id));
      }
      case 'promotion': {
        const rows = await this.prisma.saved_promotions.findMany({ where: { user_id: userId }, select: { promotion_id: true } });
        return rows.map((r) => String(r.promotion_id));
      }
      case 'post': {
        const rows = await this.prisma.saved_posts.findMany({ where: { user_id: userId }, select: { post_id: true } });
        return rows.map((r) => String(r.post_id));
      }
    }
  }

  /**
   * Liste enrichie, un type de cible à la fois.
   *
   * Pagination par curseur sur la table de favoris elle-même, puis
   * enrichissement en une seule requête `IN` sur la table cible — jamais une
   * jointure par ligne.
   */
  async list(
    userId: number,
    targetType: FavoriteTargetType,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<unknown>> {
    const cursorWhere = cursor ? prismaCursorFilter('created_at', decodeCursor(cursor)) : {};

    switch (targetType) {
      case 'product': {
        const rows = await this.prisma.favorites.findMany({
          where: { user_id: userId, ...cursorWhere },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        });
        return this.paginate(rows, limit, (r) => r.product_id, (ids) => this.enrichProducts(ids));
      }
      case 'shop': {
        const rows = await this.prisma.shop_favorites.findMany({
          where: { user_id: userId, ...cursorWhere },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        });
        return this.paginate(rows, limit, (r) => r.shop_id, (ids) => this.enrichShops(ids));
      }
      case 'promotion': {
        const rows = await this.prisma.saved_promotions.findMany({
          where: { user_id: userId, ...cursorWhere },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        });
        return this.paginate(rows, limit, (r) => r.promotion_id, (ids) => this.enrichPromotions(ids));
      }
      case 'post': {
        const rows = await this.prisma.saved_posts.findMany({
          where: { user_id: userId, ...cursorWhere },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: limit + 1,
        });
        return this.paginate(rows, limit, (r) => r.post_id, (ids) => this.enrichPosts(ids));
      }
    }
  }

  private async paginate<T extends { id: number; created_at: Date | null }>(
    rows: T[],
    limit: number,
    targetIdOf: (row: T) => number,
    enrich: (ids: number[]) => Promise<Map<number, unknown>>,
  ): Promise<Paginated<unknown>> {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const byId = await enrich(page.map(targetIdOf));
    // L'ordre des favoris (du plus récent au plus ancien) prime sur celui
    // renvoyé par la requête `IN` d'enrichissement, qui n'est pas garanti.
    const items = page.map((row) => byId.get(targetIdOf(row))).filter(Boolean);
    const last = page[page.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ value: last.created_at!.toISOString(), id: String(last.id) }) : null,
    };
  }

  private async enrichProducts(ids: number[]): Promise<Map<number, unknown>> {
    const rows = await this.prisma.products.findMany({
      where: { id: { in: ids } },
      include: { shops: { select: { name: true, slug: true } }, product_images: true },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: String(row.id),
          shopId: String(row.shop_id),
          shop: row.shops ? { name: row.shops.name, slug: row.shops.slug } : undefined,
          name: row.name,
          price: row.price,
          promoPrice: row.promo_price ?? undefined,
          currency: 'MGA',
          stock: row.stock ?? 0,
          status: row.status,
          media: row.product_images.map((img) => ({
            ...this.media.publicUrls(img.image_path),
            type: img.media_type,
            isMain: img.is_main ?? false,
          })),
        },
      ]),
    );
  }

  private async enrichShops(ids: number[]): Promise<Map<number, unknown>> {
    const rows = await this.prisma.shops.findMany({ where: { id: { in: ids } } });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: String(row.id),
          slug: row.slug,
          name: row.name,
          logo: row.logo ?? undefined,
          address: { city: row.city ?? undefined },
          status: row.status,
        },
      ]),
    );
  }

  private async enrichPromotions(ids: number[]): Promise<Map<number, unknown>> {
    const rows = await this.prisma.promotions.findMany({
      where: { id: { in: ids } },
      include: { products: { select: { id: true, name: true } }, shops: { select: { id: true, name: true, slug: true } } },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: String(row.id),
          shopId: String(row.shop_id),
          shop: { name: row.shops.name, slug: row.shops.slug },
          title: row.title,
          type: row.type,
          value: row.value,
          productId: row.product_id ? String(row.product_id) : undefined,
          product: row.products ? { name: row.products.name } : undefined,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          flash: row.flash,
          active: row.active,
        },
      ]),
    );
  }

  private async enrichPosts(ids: number[]): Promise<Map<number, unknown>> {
    const rows = await this.prisma.posts.findMany({
      where: { id: { in: ids } },
      include: { users: { select: { firstname: true, lastname: true, avatar: true } }, post_media: true },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: String(row.id),
          content: row.content ?? undefined,
          title: row.title ?? undefined,
          author: { name: `${row.users.firstname} ${row.users.lastname}`.trim(), avatar: row.users.avatar ?? undefined },
          media: row.post_media.map((m) => this.media.publicUrls(m.file_path)),
          createdAt: row.created_at,
        },
      ]),
    );
  }
}
