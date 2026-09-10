import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { decodeCursor, encodeCursor, prismaCursorFilter } from '../../common/pagination/cursor';
import { isShopOpenNow, type OpeningHourRow } from '../../common/time/open-now';
import { ROLE_TO_TEAM_ROLE } from '../users/mysql-role-mapper';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { Post, type PostDocument } from '../social/schemas/post.schema';
import { Promotion, type PromotionDocument } from '../campaigns/schemas/promotion.schema';
import { MediaService } from '../media/media.service';
import { Shop, type ShopDocument } from './schemas/shop.schema';
import type { CreateShopDto, UpdateShopDto } from './dto/shop.dto';
import type { AddTeamMemberDto, UpdateTeamMemberDto } from './dto/team.dto';

const SHOP_UPDATE_FIELDS = [
  ['name', 'name'],
  ['description', 'description'],
  ['categoryId', 'category_id'],
  ['city', 'city'],
  ['address', 'address'],
  ['phone', 'phone'],
  ['whatsapp', 'whatsapp'],
  ['deliveryRadiusKm', 'delivery_radius_km'],
  ['deliveryAvailable', 'delivery_available'],
  ['pickupAvailable', 'pickup_available'],
] as const;

@Injectable()
export class ShopsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectModel(Shop.name) private readonly mirror: Model<ShopDocument>,
    @InjectModel(Post.name) private readonly posts: Model<PostDocument>,
    @InjectModel(Promotion.name) private readonly promotions: Model<PromotionDocument>,
    private readonly media: MediaService,
  ) {}

  /**
   * Pont d'identité transitoire (§ décision du 2026-09-09) — voir
   * `AuthService.mirrorUser`, même motif : les modules pas encore migrés
   * (Commandes, Publications, Promotions, Abonnements) référencent une
   * boutique par ObjectId Mongo. Renvoie l'ObjectId stable du miroir pour un
   * `shopId` MySQL donné, en le créant si besoin.
   */
  async resolveMirrorId(shopMysqlId: number): Promise<string> {
    const shop = await this.prisma.shops.findUnique({ where: { id: shopMysqlId } });
    if (!shop) throw AppError.notFound('Boutique');
    const doc = await this.mirror.findOneAndUpdate(
      { mysqlId: shopMysqlId },
      {
        $set: { name: shop.name, slug: shop.slug },
        $setOnInsert: { mysqlId: shopMysqlId },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return String(doc._id);
  }

  async list(
    limit: number,
    cursor?: string,
    q?: string,
    openNow?: boolean,
    sort?: 'popular',
  ): Promise<Paginated<unknown>> {
    const where: Prisma.shopsWhereInput = { status: 'approved' };
    if (q) where.OR = [{ name: { contains: q } }, { description: { contains: q } }];

    const orderBy: Prisma.shopsOrderByWithRelationInput[] =
      sort === 'popular' && !cursor
        ? [{ shop_followers: { _count: 'desc' } }, { id: 'desc' }]
        : [{ created_at: 'desc' }, { id: 'desc' }];

    if (cursor) Object.assign(where, prismaCursorFilter('created_at', decodeCursor(cursor)));

    const rows = await this.prisma.shops.findMany({ where, orderBy, take: limit + 1 });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];

    const hoursByShop = await this.openingHoursByShop(items.map((s) => s.id));
    let mapped = items.map((row) => this.toJson(row, hoursByShop.get(row.id) ?? []));
    if (openNow !== undefined) mapped = mapped.filter((s) => s.isOpenNow === openNow);

    return {
      items: mapped,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ value: last.created_at!.toISOString(), id: String(last.id) }) : null,
    };
  }

  async findBySlug(slug: string): Promise<unknown> {
    const shop = await this.prisma.shops.findFirst({ where: { slug, status: 'approved' } });
    if (!shop) throw AppError.notFound('Boutique');
    const hours = (await this.openingHoursByShop([shop.id])).get(shop.id) ?? [];
    return this.toJson(shop, hours);
  }

  /**
   * Tableau de bord — `orders`/`order_items` ont migré vers MySQL (Phase 3) :
   * interrogés directement via `prisma.orders`, plus besoin du miroir pour
   * cette partie. Publications/Promotions restent sur Mongo (pas encore
   * migrées, Phase 4) : toujours interrogées par l'ObjectId du miroir.
   */
  async dashboard(shopId: string): Promise<unknown> {
    const id = Number(shopId);
    const shop = await this.prisma.shops.findUnique({ where: { id } });
    if (!shop) throw AppError.notFound('Boutique');
    const mirrorId = await this.resolveMirrorId(id);
    const mirrorObjectId = new Types.ObjectId(mirrorId);

    const [productCount, teamCount, orderCount, customerCount, revenue, periods, topProductsRaw, followers, postStats, promotionStats, deliveryRevenue, visitors, byStatusRows, lowStock, deliveredCount] =
      await Promise.all([
        this.prisma.products.count({ where: { shop_id: id } }),
        this.prisma.shop_team_members.count({ where: { shop_id: id } }),
        this.prisma.orders.count({ where: { shop_id: id } }),
        this.prisma.orders.groupBy({ by: ['user_id'], where: { shop_id: id } }).then((rows) => rows.length),
        this.prisma.orders.aggregate({ where: { shop_id: id, status: { not: 'cancelled' } }, _sum: { total_amount: true } }),
        this.prisma.$queryRaw<{ day: string; week: number; month: string; sales: string; orders: bigint }[]>`
          SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, WEEK(created_at, 3) AS week,
                 DATE_FORMAT(created_at, '%Y-%m') AS month,
                 SUM(total_amount) AS sales, COUNT(*) AS orders
          FROM orders WHERE shop_id = ${id} AND status = 'delivered'
          GROUP BY day, week, month ORDER BY day DESC
        `,
        this.prisma.$queryRaw<{ productId: number; quantity: bigint; revenue: string }[]>`
          SELECT oi.product_id AS productId, SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price) AS revenue
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.shop_id = ${id} AND o.status = 'delivered'
          GROUP BY oi.product_id ORDER BY quantity DESC LIMIT 10
        `,
        this.prisma.shop_followers.count({ where: { shop_id: id } }),
        this.posts.aggregate([
          { $match: { $or: [{ shopId: mirrorObjectId }, { 'author.shopId': mirrorObjectId }] } },
          {
            $group: {
              _id: null,
              posts: { $sum: 1 },
              likes: { $sum: '$counters.reactions' },
              comments: { $sum: '$counters.comments' },
              shares: { $sum: '$counters.shares' },
              reach: { $sum: '$counters.views' },
            },
          },
        ]),
        this.promotions.aggregate([
          { $match: { shopId: mirrorObjectId } },
          { $group: { _id: null, count: { $sum: 1 }, active: { $sum: { $cond: ['$active', 1, 0] } } } },
        ]),
        this.prisma.orders.aggregate({ where: { shop_id: id, status: 'delivered' }, _sum: { shipping_fee: true } }),
        this.prisma.products.aggregate({ where: { shop_id: id }, _sum: { views: true } }),
        this.prisma.orders.groupBy({ by: ['status'], where: { shop_id: id }, _count: true }),
        this.lowStockCount(id),
        this.prisma.orders.count({ where: { shop_id: id, status: 'delivered' } }),
      ]);

    // Noms de produits pour le classement — `attachProductNames` reste utile
    // même maintenant que la source est MySQL : évite une jointure `products`
    // dans chacune des deux requêtes brutes ci-dessus.
    const topProducts = await this.attachProductNames(
      topProductsRaw.map((r) => ({ _id: r.productId, quantity: Number(r.quantity), revenue: Number(r.revenue) })),
    );
    const periodsMapped = periods.map((p) => ({
      _id: { day: p.day, week: p.week, month: p.month },
      sales: Number(p.sales),
      orders: Number(p.orders),
    }));
    const byStatus = byStatusRows.map((row) => ({ _id: row.status, count: row._count }));

    const totalRevenue = Number(revenue._sum.total_amount ?? 0);
    return {
      shopId: String(id),
      revenue: totalRevenue,
      orders: orderCount,
      sales: deliveredCount,
      products: productCount,
      stock: { lowStock },
      customers: customerCount,
      promotions: promotionStats[0]?.count ?? 0,
      statistics: { byStatus },
      notifications: 0,
      stats: {
        productCount,
        rating: 0,
        reviewCount: 0,
        followerCount: followers,
      },
      team: teamCount,
      analytics: {
        salesByPeriod: periodsMapped,
        topProducts,
        leastSoldProducts: [...topProducts].sort((a, b) => a.quantity - b.quantity),
        averageBasket: orderCount ? totalRevenue / orderCount : 0,
        visitors: visitors._sum.views ?? 0,
        followers,
        publicationEngagement: postStats[0] ?? { posts: 0, likes: 0, comments: 0, shares: 0, reach: 0 },
        promotionPerformance: promotionStats[0] ?? { count: 0, active: 0 },
        deliveryRevenue: Number(deliveryRevenue._sum.shipping_fee ?? 0),
      },
    };
  }

  /** `stock <= min_stock` — comparaison colonne à colonne, hors de portée du filtre Prisma habituel. */
  private async lowStockCount(shopId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM products
      WHERE shop_id = ${shopId} AND status = 'published' AND stock <= min_stock
    `;
    return Number(rows[0]?.count ?? 0);
  }

  private async attachProductNames(
    rows: Array<{ _id: unknown; quantity: number; revenue: number }>,
  ): Promise<Array<{ productId: string; name: string; quantity: number; revenue: number }>> {
    const numericIds = rows.map((r) => Number(r._id)).filter((id) => Number.isInteger(id));
    const products = numericIds.length
      ? await this.prisma.products.findMany({ where: { id: { in: numericIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    return rows.map((r) => ({
      productId: String(r._id),
      name: nameById.get(Number(r._id)) ?? 'Produit',
      quantity: r.quantity,
      revenue: r.revenue,
    }));
  }

  /**
   * Clients de la boutique — le tableau de bord n'en affichait qu'un compte
   * sans jamais donner accès aux personnes elles-mêmes. `orders` a migré vers
   * MySQL (Phase 3) : jointure `users` directe, plus besoin du miroir.
   */
  async customers(shopId: string): Promise<unknown[]> {
    const id = Number(shopId);
    const rows = await this.prisma.$queryRaw<{
      userId: number; firstname: string; lastname: string; phone: string | null;
      orders: bigint; totalSpent: string; lastOrderAt: Date;
    }[]>`
      SELECT o.user_id AS userId, u.firstname AS firstname, u.lastname AS lastname, u.phone AS phone,
             COUNT(*) AS orders, SUM(o.total_amount) AS totalSpent, MAX(o.created_at) AS lastOrderAt
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.shop_id = ${id} AND o.status != 'cancelled'
      GROUP BY o.user_id, u.firstname, u.lastname, u.phone
      ORDER BY lastOrderAt DESC LIMIT 200
    `;
    return rows.map((r) => ({
      _id: String(r.userId),
      name: `${r.firstname} ${r.lastname}`.trim(),
      phone: r.phone,
      orders: Number(r.orders),
      totalSpent: Number(r.totalSpent),
      lastOrderAt: r.lastOrderAt,
    }));
  }

  async create(ownerId: number, dto: CreateShopDto): Promise<unknown> {
    const created = await this.prisma.shops.create({
      data: {
        user_id: ownerId,
        category_id: dto.categoryId ? Number(dto.categoryId) : undefined,
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        logo: dto.logo,
        banner: dto.banner,
        phone: dto.phone,
        whatsapp: dto.whatsapp,
        city: dto.city,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        delivery_radius_km: dto.deliveryRadiusKm ?? 5,
        delivery_available: dto.deliveryAvailable ?? true,
        pickup_available: dto.pickupAvailable ?? false,
        status: 'pending',
      },
    });
    await this.resolveMirrorId(created.id);
    return this.toJson(created, []);
  }

  async update(ownerId: number, shopId: string, dto: UpdateShopDto): Promise<unknown> {
    const existing = await this.prisma.shops.findFirst({ where: { id: Number(shopId), user_id: ownerId } });
    if (!existing) throw AppError.notFound('Boutique');

    const data: Prisma.shopsUpdateInput = {};
    for (const [dtoField, column] of SHOP_UPDATE_FIELDS) {
      const value = dto[dtoField];
      if (value === undefined) continue;
      (data as Record<string, unknown>)[column] = dtoField === 'categoryId' ? Number(value) : value;
    }
    // Une clé de téléversement se résout en URL ici, jamais côté mobile.
    if (dto.logoKey) data.logo = this.media.publicUrls(dto.logoKey).thumbUrl;
    else if (dto.logo !== undefined) data.logo = dto.logo;
    if (dto.banner !== undefined) data.banner = dto.banner;
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;

    const updated = await this.prisma.shops.update({ where: { id: existing.id }, data });

    // Mise à jour du nom/slug sur le miroir : le nom d'une boutique change
    // rarement, mais autant rester cohérent pour les modules pas encore
    // migrés qui l'affichent parfois directement.
    await this.mirror.updateOne({ mysqlId: updated.id }, { $set: { name: updated.name, slug: updated.slug } });

    const hours = (await this.openingHoursByShop([updated.id])).get(updated.id) ?? [];
    return this.toJson(updated, hours);
  }

  /** Membres d'équipe. `shop_team_members.user_id` est UNIQUE (§ décision confirmée) : un utilisateur = une seule boutique à la fois. */
  async team(shopId: string): Promise<unknown[]> {
    const rows = await this.prisma.shop_team_members.findMany({
      where: { shop_id: Number(shopId) },
      include: { users: { select: { id: true, firstname: true, lastname: true, avatar: true } } },
    });
    return rows.map((row) => ({
      userId: String(row.user_id),
      name: `${row.users.firstname} ${row.users.lastname}`.trim(),
      avatar: row.users.avatar ?? undefined,
      role: row.team_role,
      status: row.status,
    }));
  }

  async addTeamMember(shopId: string, dto: AddTeamMemberDto): Promise<unknown[]> {
    const last9 = AuthService.last9Digits(AuthService.normalisePhone(dto.phone));
    const user = await this.prisma.users.findFirst({ where: { phone: { endsWith: last9 } } });
    if (!user) throw AppError.notFound('Utilisateur');

    const existingMembership = await this.prisma.shop_team_members.findUnique({ where: { user_id: user.id } });
    if (existingMembership) {
      throw new AppError(
        'TEAM_MEMBER_EXISTS',
        existingMembership.shop_id === Number(shopId)
          ? 'Cet utilisateur est déjà membre de la boutique.'
          : "Cet utilisateur est déjà membre de l'équipe d'une autre boutique.",
        409,
      );
    }

    await this.prisma.shop_team_members.create({
      data: {
        shop_id: Number(shopId),
        user_id: user.id,
        team_role: ShopsService.toTeamRole(dto.role),
        status: 'active',
      },
    });
    return this.team(shopId);
  }

  async updateTeamMember(shopId: string, userId: string, dto: UpdateTeamMemberDto): Promise<unknown[]> {
    const result = await this.prisma.shop_team_members.updateMany({
      where: { shop_id: Number(shopId), user_id: Number(userId) },
      data: { team_role: ShopsService.toTeamRole(dto.role) },
    });
    if (!result.count) throw AppError.notFound('Membre');
    return this.team(shopId);
  }

  async removeTeamMember(shopId: string, userId: string): Promise<{ removed: true }> {
    const result = await this.prisma.shop_team_members.deleteMany({
      where: { shop_id: Number(shopId), user_id: Number(userId) },
    });
    if (!result.count) throw AppError.notFound('Membre');
    return { removed: true };
  }

  /** Publications d'une boutique — reste sur Mongo (pas encore migré), via le miroir. */
  async postsFor(shopId: string, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const mirrorId = await this.resolveMirrorId(Number(shopId));
    const filter: Record<string, unknown> = { 'author.type': 'shop', 'author.shopId': mirrorId };
    if (cursor) {
      const decoded = decodeCursor(cursor);
      Object.assign(filter, {
        $or: [{ createdAt: { $lt: decoded.value } }, { createdAt: decoded.value, _id: { $lt: decoded.id } }],
      });
    }

    const docs = await this.posts.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;
    const last = items[items.length - 1] as { _id: unknown; createdAt: Date } | undefined;

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ value: last.createdAt.toISOString(), id: String(last._id) }) : null,
    };
  }

  /** Boutiques où l'utilisateur détient un rôle — sélecteur de profil (§11.2). */
  async myShops(userId: number): Promise<unknown[]> {
    const rows = await this.prisma.shops.findMany({
      where: {
        OR: [{ user_id: userId }, { shop_team_members: { some: { user_id: userId } } }],
      },
      select: { id: true, name: true, slug: true, logo: true, status: true },
    });
    return rows.map((r) => ({ id: String(r.id), name: r.name, slug: r.slug, logo: r.logo ?? undefined, status: r.status }));
  }

  private static toTeamRole(role: string): Prisma.shop_team_membersCreateInput['team_role'] {
    const mapped = ROLE_TO_TEAM_ROLE[role as keyof typeof ROLE_TO_TEAM_ROLE];
    if (!mapped) throw new AppError('INVALID_ROLE', `Rôle d'équipe invalide : ${role}.`, 400);
    return mapped as Prisma.shop_team_membersCreateInput['team_role'];
  }

  /** MariaDB renvoie une colonne `TIME` comme une date épochée à 1970-01-01 UTC. */
  private static hhmm(value: Date): string {
    return String(value.getUTCHours()).padStart(2, '0') + ':' + String(value.getUTCMinutes()).padStart(2, '0');
  }

  private async openingHoursByShop(shopIds: number[]): Promise<Map<number, OpeningHourRow[]>> {
    if (shopIds.length === 0) return new Map();
    const rows = await this.prisma.shop_opening_hours.findMany({ where: { shop_id: { in: shopIds } } });
    const byShop = new Map<number, OpeningHourRow[]>();
    for (const row of rows) {
      const list = byShop.get(row.shop_id) ?? [];
      list.push(row);
      byShop.set(row.shop_id, list);
    }
    return byShop;
  }

  private toJson(
    row: {
      id: number;
      name: string;
      slug: string;
      description: string | null;
      logo: string | null;
      banner: string | null;
      category_id: number | null;
      city: string | null;
      address: string | null;
      phone: string | null;
      whatsapp: string | null;
      latitude: unknown;
      longitude: unknown;
      delivery_radius_km: unknown;
      delivery_available: boolean;
      pickup_available: boolean;
      status: string | null;
      is_featured: boolean | null;
      created_at: Date | null;
      updated_at: Date | null;
    },
    hours: OpeningHourRow[],
  ): { id: string; isOpenNow: boolean; [key: string]: unknown } {
    const lat = row.latitude === null ? null : Number(row.latitude);
    const lng = row.longitude === null ? null : Number(row.longitude);
    return {
      id: String(row.id),
      name: row.name,
      slug: row.slug,
      description: row.description ?? undefined,
      logo: row.logo ?? undefined,
      banner: row.banner ?? undefined,
      categoryId: row.category_id ? String(row.category_id) : undefined,
      address: { city: row.city ?? undefined, line: row.address ?? undefined },
      contact: { phone: row.phone ?? undefined, whatsapp: row.whatsapp ?? undefined },
      location: lat === null || lng === null ? undefined : { type: 'Point', coordinates: [lng, lat] },
      deliveryRadiusKm: row.delivery_radius_km ? Number(row.delivery_radius_km) : 5,
      deliveryAvailable: row.delivery_available,
      pickupAvailable: row.pickup_available,
      openingHours: hours.map((h) => ({
        day: h.day_of_week,
        open: ShopsService.hhmm(h.opens_at),
        close: ShopsService.hhmm(h.closes_at),
      })),
      status: row.status,
      isFeatured: row.is_featured ?? false,
      isOpenNow: isShopOpenNow(hours),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
