import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
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
    const shopObjectId = new Types.ObjectId(shopId);
    const [orders, products, customers, revenue, periods, topProducts, followers, postStats, promotions, deliveryRevenue, visitors] = await Promise.all([
      this.orders.countDocuments({ shopId }),
      this.products.countDocuments({ shopId }),
      this.orders.distinct('userId', { shopId }),
      this.orders.aggregate([{ $match: { shopId: shopObjectId, status: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$amounts.total' } } }]),
      this.orders.aggregate([{ $match: { shopId: shopObjectId, status: 'delivered' } }, { $group: { _id: { day: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, week: { $isoWeek: '$createdAt' }, month: { $dateToString: { date: '$createdAt', format: '%Y-%m' } } }, sales: { $sum: '$amounts.total' }, orders: { $sum: 1 } } }, { $sort: { '_id.day': -1 } }]),
      this.orders.aggregate([{ $match: { shopId: shopObjectId, status: 'delivered' } }, { $unwind: '$items' }, { $group: { _id: '$items.productId', quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotal' } } }, { $sort: { quantity: -1 } }, { $limit: 10 }]),
      this.follows.countDocuments({ targetType: 'shop', targetId: shopObjectId }),
      this.posts.aggregate([{ $match: { $or: [{ shopId: shopObjectId }, { 'author.shopId': shopObjectId }] } }, { $group: { _id: null, posts: { $sum: 1 }, likes: { $sum: '$counters.reactions' }, comments: { $sum: '$counters.comments' }, shares: { $sum: '$counters.shares' }, reach: { $sum: '$counters.views' } } }]),
      this.promotions.aggregate([{ $match: { shopId: shopObjectId } }, { $group: { _id: null, count: { $sum: 1 }, active: { $sum: { $cond: ['$active', 1, 0] } } } }]),
      this.orders.aggregate([{ $match: { shopId: shopObjectId, status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$amounts.shippingFee' } } }]),
      this.products.aggregate([{ $match: { shopId: shopObjectId } }, { $group: { _id: null, views: { $sum: '$stats.views' } } }]),
    ]);
    const byStatus = await this.orders.aggregate([{ $match: { shopId: shopObjectId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
    const lowStock = await this.products.countDocuments({ shopId, status: 'published', $expr: { $lte: ['$stock', '$minStock'] } });
    return {
      shopId: String(shop._id),
      revenue: revenue[0]?.total ?? 0,
      orders,
      sales: await this.orders.countDocuments({ shopId, status: 'delivered' }),
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

  async create(ownerId: string, dto: CreateShopDto): Promise<unknown> {
    const shop = await this.shops.create({
      ...dto,
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
    Object.assign(shop, dto);
    shop.contact = { ...shop.contact, phone: dto.phone, whatsapp: dto.whatsapp };
    shop.address = { ...shop.address, city: dto.city, line: dto.address };
    await shop.save();
    return shop.toJSON();
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

  /** Boutiques où l'utilisateur détient un rôle — alimente le sélecteur de profil (§11.2). */
  async myShops(userId: string): Promise<unknown[]> {
    return this.shops
      .find({ 'team.userId': new Types.ObjectId(userId) })
      .select('name slug logo status stats')
      .lean();
  }
}
