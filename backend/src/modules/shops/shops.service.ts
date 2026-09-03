import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { closedNowFilter, openNowFilter, withOpenNow } from '../../common/time/open-now';
import { Shop, type ShopDocument } from './schemas/shop.schema';
import { Order, type OrderDocument } from '../orders/schemas/order.schema';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import type { CreateShopDto, UpdateShopDto } from './dto/shop.dto';
import { Role } from '../../common/rbac/roles';
import { Post, type PostDocument } from '../social/schemas/post.schema';
import { Follow, type FollowDocument } from '../social/schemas/interactions.schema';
import { Promotion, type PromotionDocument } from '../campaigns/schemas/promotion.schema';
import { User, type UserDocument } from '../users/schemas/user.schema';
import type { AddTeamMemberDto, UpdateTeamMemberDto } from './dto/team.dto';

@Injectable()
export class ShopsService {
  constructor(
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Post.name) private readonly posts: Model<PostDocument>,
    @InjectModel(Follow.name) private readonly follows: Model<FollowDocument>,
    @InjectModel(Promotion.name) private readonly promotions: Model<PromotionDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  async list(
    limit: number,
    cursor?: string,
    q?: string,
    openNow?: boolean,
    sort?: 'popular',
  ): Promise<Paginated<unknown>> {
    // Seules les boutiques validées sont publiques : la modération reste sur le
    // back-office web (§2.1), mais son verdict est opposable ici.
    const filter: Record<string, unknown> = { status: 'approved' };
    if (q) filter.$text = { $search: q };
    if (openNow === true) Object.assign(filter, openNowFilter());
    if (openNow === false) Object.assign(filter, closedNowFilter());

    // Un rail « populaires » n'est jamais paginé (voir `CatalogService`, même
    // motif) : le curseur cible une position sur le tri par date, incohérente
    // avec un tri par abonnés.
    const order: Record<string, 1 | -1> =
      sort === 'popular' && !cursor
        ? { 'stats.followerCount': -1, _id: -1 }
        : { createdAt: -1, _id: -1 };

    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const docs = await this.shops
      .find(filter)
      .sort(order)
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const items = (hasMore ? docs.slice(0, limit) : docs).map(withOpenNow);
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
    return withOpenNow(shop);
  }

  /**
   * Tableau de bord d'une boutique.
   * TODO(L5) : agrégats du jour — chiffre d'affaires, commandes par statut,
   * alertes de stock, top produits.
   */
  async dashboard(shopId: string): Promise<unknown> {
    const shop = await this.shops.findById(shopId).lean();
    if (!shop) throw AppError.notFound('Boutique');
    const shopObjectId = new Types.ObjectId(shopId);
    const [orders, products, customers, revenue, periods, topProducts, followers, postStats, promotions, deliveryRevenue, visitors] = await Promise.all([
      this.orders.countDocuments({ shopId: shopObjectId }),
      this.products.countDocuments({ shopId: shopObjectId }),
      this.orders.distinct('userId', { shopId: shopObjectId }),
      this.orders.aggregate([{ $match: { shopId: shopObjectId, status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$amounts.total' } } }]),
      this.orders.aggregate([{ $match: { shopId: shopObjectId, status: 'delivered' } }, { $group: { _id: { day: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, week: { $isoWeek: '$createdAt' }, month: { $dateToString: { date: '$createdAt', format: '%Y-%m' } } }, sales: { $sum: '$amounts.total' }, orders: { $sum: 1 } } }, { $sort: { '_id.day': -1 } }]),
      this.orders.aggregate([
        { $match: { shopId: shopObjectId, status: 'delivered' } },
        { $unwind: '$items' },
        { $group: { _id: '$items.productId', quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotal' } } },
        { $sort: { quantity: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product',
            pipeline: [{ $project: { name: 1 } }],
          },
        },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      ]),
      this.follows.countDocuments({ targetType: 'shop', targetId: shopObjectId }),
      this.posts.aggregate([{ $match: { $or: [{ shopId: shopObjectId }, { 'author.shopId': shopObjectId }] } }, { $group: { _id: null, posts: { $sum: 1 }, likes: { $sum: '$counters.reactions' }, comments: { $sum: '$counters.comments' }, shares: { $sum: '$counters.shares' }, reach: { $sum: '$counters.views' } } }]),
      this.promotions.aggregate([{ $match: { shopId: shopObjectId } }, { $group: { _id: null, count: { $sum: 1 }, active: { $sum: { $cond: ['$active', 1, 0] } } } }]),
      this.orders.aggregate([{ $match: { shopId: shopObjectId, status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$amounts.shippingFee' } } }]),
      this.products.aggregate([{ $match: { shopId: shopObjectId } }, { $group: { _id: null, views: { $sum: '$stats.views' } } }]),
    ]);
    const byStatus = await this.orders.aggregate([{ $match: { shopId: shopObjectId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    const lowStock = await this.products.countDocuments({ shopId: shopObjectId, status: 'published', $expr: { $lte: ['$stock', '$minStock'] } });
    return {
      shopId: String(shop._id),
      revenue: revenue[0]?.total ?? 0,
      orders,
      sales: await this.orders.countDocuments({ shopId: shopObjectId, status: 'delivered' }),
      products,
      stock: { lowStock },
      customers: customers.length,
      promotions: 0,
      statistics: { byStatus },
      notifications: 0,
      stats: shop.stats,
      team: shop.team.length,
      analytics: {
        salesByPeriod: periods,
        topProducts,
        leastSoldProducts: [...topProducts].sort((a, b) => a.quantity - b.quantity),
        averageBasket: orders ? (revenue[0]?.total ?? 0) / orders : 0,
        visitors: visitors[0]?.views ?? 0,
        followers,
        publicationEngagement: postStats[0] ?? { posts: 0, likes: 0, comments: 0, shares: 0, reach: 0 },
        promotionPerformance: promotions[0] ?? { count: 0, active: 0 },
        deliveryRevenue: deliveryRevenue[0]?.total ?? 0,
      },
    };
  }

  /**
   * Clients de la boutique — le tableau de bord n'en affichait qu'un compte
   * (`orders.distinct('userId').length`) sans jamais donner accès aux
   * personnes elles-mêmes : impossible de recontacter son meilleur client ou
   * de repérer qui n'a plus commandé depuis longtemps.
   */
  async customers(shopId: string): Promise<unknown[]> {
    const shopObjectId = new Types.ObjectId(shopId);
    const rows = await this.orders.aggregate([
      { $match: { shopId: shopObjectId, status: { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$userId',
          name: { $last: '$customer.name' },
          phone: { $last: '$customer.phone' },
          orders: { $sum: 1 },
          totalSpent: { $sum: '$amounts.total' },
          lastOrderAt: { $max: '$createdAt' },
        },
      },
      { $sort: { lastOrderAt: -1 } },
      { $limit: 200 },
    ]);
    return rows;
  }

  async create(ownerId: string, dto: CreateShopDto): Promise<unknown> {
    const location = ShopsService.toGeoPoint(dto.latitude, dto.longitude);
    const shop = await this.shops.create({
      ...dto,
      location,
      ownerId: new Types.ObjectId(ownerId),
      contact: { phone: dto.phone, whatsapp: dto.whatsapp },
      address: { city: dto.city, line: dto.address },
      team: [{ userId: new Types.ObjectId(ownerId), name: ownerId, role: Role.ShopOwner, status: 'active' }],
    });
    return shop.toJSON();
  }

  async update(ownerId: string, shopId: string, dto: UpdateShopDto): Promise<unknown> {
    const shop = await this.shops.findOne({ _id: shopId, ownerId });
    if (!shop) throw AppError.notFound('Boutique');

    // `UpdateShopDto` est partielle (§17) : un champ absent doit rester
    // inchangé, jamais être écrasé par `undefined` — `Object.assign` ou un
    // spread naïf le ferait pour peu qu'une classe TypeScript matérialise ses
    // champs déclarés en propriétés propres.
    for (const field of [
      'name', 'description', 'logo', 'banner', 'categoryId', 'categoryName',
      'deliveryRadiusKm', 'deliveryAvailable', 'pickupAvailable', 'deliveryFee',
      'closedDays', 'openingHours',
    ] as const) {
      if (dto[field] !== undefined) (shop as unknown as Record<string, unknown>)[field] = dto[field];
    }
    shop.contact = {
      ...shop.contact,
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
      ...(dto.whatsapp !== undefined ? { whatsapp: dto.whatsapp } : {}),
    };
    shop.address = {
      ...shop.address,
      ...(dto.city !== undefined ? { city: dto.city } : {}),
      ...(dto.address !== undefined ? { line: dto.address } : {}),
    };
    const location = ShopsService.toGeoPoint(dto.latitude, dto.longitude);
    if (location) shop.location = location;
    await shop.save();
    // Le champ `location` d'un produit n'est qu'une recopie de celui de sa
    // boutique (§ schéma produit) : un déménagement doit se répercuter sur
    // tout le catalogue, sinon « produits autour de moi » désynchronise
    // silencieusement de « boutiques autour de moi ».
    if (location) {
      await this.products.updateMany({ shopId: shop._id }, { $set: { location } });
    }
    return shop.toJSON();
  }

  private static toGeoPoint(
    latitude?: number,
    longitude?: number,
  ): { type: 'Point'; coordinates: [number, number] } | undefined {
    if (latitude === undefined || longitude === undefined) return undefined;
    return { type: 'Point', coordinates: [longitude, latitude] };
  }

  /** Membres d'équipe — un utilisateur peut appartenir à plusieurs boutiques (§3.1). */
  async team(shopId: string): Promise<unknown[]> {
    const shop = await this.shops.findById(shopId).select('team').lean();
    if (!shop) throw AppError.notFound('Boutique');
    return shop.team;
  }

  async addTeamMember(shopId: string, dto: AddTeamMemberDto): Promise<unknown[]> {
    const [shop, user] = await Promise.all([
      this.shops.findById(shopId),
      this.users.findOne({ phone: dto.phone }).select('firstName lastName avatar roles'),
    ]);
    if (!shop) throw AppError.notFound('Boutique');
    if (!user) throw AppError.notFound('Utilisateur');
    if (shop.team.some((member) => String(member.userId) === String(user._id))) {
      throw new AppError('TEAM_MEMBER_EXISTS', 'Cet utilisateur est déjà membre de la boutique.', 409);
    }
    shop.team.push({
      userId: user._id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      avatar: user.avatar,
      role: dto.role as Role,
      status: 'active',
      joinedAt: new Date(),
    });
    user.roles = [...user.roles, { role: dto.role as Role, shopId: shop._id }];
    await Promise.all([shop.save(), user.save()]);
    return shop.team;
  }

  async updateTeamMember(shopId: string, userId: string, dto: UpdateTeamMemberDto): Promise<unknown[]> {
    const shop = await this.shops.findById(shopId);
    const user = await this.users.findById(userId);
    if (!shop || !user) throw AppError.notFound('Membre');
    const member = shop.team.find((item) => String(item.userId) === userId);
    if (!member || member.role === Role.ShopOwner) throw AppError.notFound('Membre');
    member.role = dto.role as Role;
    user.roles = user.roles.map((assignment) =>
      String(assignment.shopId) === shopId && assignment.role !== Role.ShopOwner
        ? { ...assignment, role: dto.role as Role }
        : assignment,
    );
    await Promise.all([shop.save(), user.save()]);
    return shop.team;
  }

  async removeTeamMember(shopId: string, userId: string): Promise<{ removed: true }> {
    const shop = await this.shops.findById(shopId);
    const user = await this.users.findById(userId);
    if (!shop || !user) throw AppError.notFound('Membre');
    const member = shop.team.find((item) => String(item.userId) === userId);
    if (!member || member.role === Role.ShopOwner) throw AppError.notFound('Membre');
    shop.team = shop.team.filter((item) => String(item.userId) !== userId);
    user.roles = user.roles.filter((assignment) => !(String(assignment.shopId) === shopId && assignment.role !== Role.ShopOwner));
    await Promise.all([shop.save(), user.save()]);
    return { removed: true };
  }

  /** Publications d'une boutique — alimente l'onglet « Publications » de sa fiche (§4). */
  async postsFor(shopId: string, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = {
      'author.type': 'shop',
      'author.shopId': new Types.ObjectId(shopId),
    };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const docs = await this.posts
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;
    const last = items[items.length - 1] as { _id: unknown; createdAt: Date } | undefined;

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: String(last._id) })
          : null,
    };
  }

  /** Boutiques où l'utilisateur détient un rôle — alimente le sélecteur de profil (§11.2). */
  async myShops(userId: string): Promise<unknown[]> {
    return this.shops
      .find({ 'team.userId': new Types.ObjectId(userId) })
      .select('name slug logo status stats')
      .lean();
  }
}
