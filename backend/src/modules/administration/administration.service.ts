import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { CourierEarningsService } from '../courier-earnings/courier-earnings.service';
import { FinanceService } from '../finance/finance.service';
import { Review, type ReviewDocument } from '../reviews/schemas/review.schema';
import { Post, type PostDocument } from '../social/schemas/post.schema';
import { Report, type ReportDocument } from '../moderation/schemas/report.schema';
import { AdminLogsService } from '../admin-logs/admin-logs.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

type DisputeStatus = 'resolved' | 'rejected';

@Injectable()
export class AdministrationService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    @InjectModel(Post.name) private readonly posts: Model<PostDocument>,
    @InjectModel(Report.name) private readonly reports: Model<ReportDocument>,
    private readonly prisma: PrismaService,
    private readonly courierEarnings: CourierEarningsService,
    private readonly finance: FinanceService,
    private readonly adminLogs: AdminLogsService,
  ) {}

  usersList(status?: string) {
    return this.users.find(status ? { status } : {}).select('phone email firstName lastName avatar status roles courierProfile createdAt').sort({ createdAt: -1 }).limit(200).lean();
  }
  async updateUser(
    id: string,
    patch: { status?: 'active' | 'suspended' | 'pending'; roles?: unknown[] },
    admin: AuthenticatedUser,
  ) {
    if (!Types.ObjectId.isValid(id)) throw AppError.notFound('Utilisateur');
    const user = await this.users.findByIdAndUpdate(id, { $set: patch }, { new: true }).select('phone firstName lastName status roles');
    if (!user) throw AppError.notFound('Utilisateur');
    await this.adminLogs.log(admin, `updateUser(user=${id}, patch=${JSON.stringify(patch)})`, 'user');
    return user;
  }
  async removeUser(id: string, admin: AuthenticatedUser) {
    const result = await this.users.updateOne({ _id: id }, { $set: { status: 'suspended' } });
    if (!result.modifiedCount) throw AppError.notFound('Utilisateur');
    await this.adminLogs.log(admin, `removeUser(user=${id})`, 'user');
    return { deleted: true, suspended: true };
  }

  shopsList(status?: string) {
    return this.prisma.shops.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { created_at: 'desc' },
      take: 200,
    });
  }
  async updateShop(id: string, status: 'pending' | 'approved' | 'rejected' | 'suspended', admin: AuthenticatedUser) {
    const shop = await this.prisma.shops.update({ where: { id: Number(id) }, data: { status } }).catch(() => null);
    if (!shop) throw AppError.notFound('Boutique');
    await this.adminLogs.log(admin, `updateShop(shop=${id}, status=${status})`, 'shop');
    return shop;
  }

  productsList(status?: string) {
    return this.prisma.products.findMany({
      where: status ? { status: status as never } : {},
      select: {
        id: true, name: true, shop_id: true, category_id: true, price: true,
        promo_price: true, stock: true, status: true, is_hidden: true, created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    });
  }
  async moderateProduct(id: string, status: 'draft' | 'published' | 'archived', isHidden: boolean | undefined, admin: AuthenticatedUser) {
    const product = await this.prisma.products
      .update({ where: { id: Number(id) }, data: { status, ...(isHidden === undefined ? {} : { is_hidden: isHidden }) } })
      .catch(() => null);
    if (!product) throw AppError.notFound('Produit');
    await this.adminLogs.log(admin, `moderateProduct(product=${id}, status=${status})`, 'product');
    return product;
  }
  async removeProduct(id: string, admin: AuthenticatedUser) {
    const result = await this.prisma.products.updateMany({ where: { id: Number(id) }, data: { status: 'archived', is_hidden: true } });
    if (!result.count) throw AppError.notFound('Produit');
    await this.adminLogs.log(admin, `removeProduct(product=${id})`, 'product');
    return { deleted: true, archived: true };
  }
  /**
   * File des produits signalés — `isReported` n'existe plus côté MySQL
   * (Phase 2) : déduit des signalements en attente (`Report`, Mongo,
   * `targetType: 'product'`) plutôt qu'un drapeau à resynchroniser.
   */
  async reportedProducts() {
    const pending = await this.reports.find({ targetType: 'product', status: 'pending' }).distinct('targetId');
    const ids = pending.map((id) => Number(id)).filter((id) => Number.isInteger(id));
    if (ids.length === 0) return [];
    return this.prisma.products.findMany({ where: { id: { in: ids } }, orderBy: { updated_at: 'desc' }, take: 200 });
  }

  // --- Commandes et litiges — migré sur MySQL (Phase 3) -----------------------

  async ordersList(status?: string) {
    const rows = await this.prisma.orders.findMany({
      where: status ? { status: status as never } : {},
      include: { order_items: true, shops: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
      take: 300,
    });
    return rows.map((o) => ({
      id: String(o.id),
      orderNumber: o.order_number,
      userId: String(o.user_id),
      shopId: String(o.shop_id),
      shopName: o.shops.name,
      amounts: { shippingFee: o.shipping_fee ?? 0, discount: o.discount_amount ?? 0, tip: o.tip_amount ?? 0, total: o.total_amount },
      payment: { method: o.payment_method, status: o.payment_status },
      status: o.status,
      itemCount: o.order_items.length,
      createdAt: o.created_at,
      updatedAt: o.updated_at,
    }));
  }

  /** Délègue à `FinanceService` (§30) : un remboursement dépose désormais un `Refund` qualifié et une ligne de grand livre, jamais une simple bascule de statut. */
  async refundOrder(id: string, admin: AuthenticatedUser) {
    const result = await this.finance.createRefund(id, undefined, 'Remboursement administratif', admin.mysqlId);
    await this.adminLogs.log(admin, `refundOrder(order=${id})`, 'order');
    return result;
  }

  async disputesList(status?: string) {
    const rows = await this.prisma.order_disputes.findMany({
      where: status ? { status: status as DisputeStatus | 'open' } : {},
      include: { orders: { select: { order_number: true, shop_id: true } } },
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    return rows.map((d) => ({
      id: String(d.id),
      orderId: String(d.order_id),
      orderNumber: d.orders.order_number,
      shopId: String(d.orders.shop_id),
      raisedBy: String(d.raised_by),
      reason: d.reason,
      status: d.status,
      resolution: d.resolution,
      resolvedBy: d.resolved_by ? String(d.resolved_by) : undefined,
      resolvedAt: d.resolved_at,
      createdAt: d.created_at,
    }));
  }

  async resolveDispute(id: string, status: DisputeStatus, resolution: string | undefined, admin: AuthenticatedUser) {
    const dispute = await this.prisma.order_disputes
      .update({
        where: { id: Number(id) },
        data: { status, resolution, resolved_by: admin.mysqlId, resolved_at: new Date() },
      })
      .catch(() => null);
    if (!dispute) throw AppError.notFound('Litige');
    await this.adminLogs.log(admin, `resolveDispute(dispute=${id}, status=${status})`, 'dispute');
    return dispute;
  }

  async grantCourierBonus(courierId: number, amount: number, reason: string, admin: AuthenticatedUser) {
    const result = await this.courierEarnings.grantBonus(courierId, amount, reason, admin.mysqlId);
    await this.adminLogs.log(admin, `grantCourierBonus(courier=${courierId}, amount=${amount})`, 'courier');
    return result;
  }

  /**
   * Dashboard global — §31. Une seule vue d'ensemble plutôt que de naviguer
   * entre les sections `usersList`/`ordersList`/etc. pour reconstituer une
   * tendance à la main — même esprit que `ShopsService.dashboard()`, à
   * l'échelle de la plateforme entière plutôt que d'une boutique.
   */
  async dashboard(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);

    const [
      userCount,
      shopCount,
      productCount,
      orderCount,
      reviewCount,
      postCount,
      revenue,
      byStatusRows,
      paymentBreakdownRows,
      userGrowth,
      shopGrowth,
      topProducts,
      topZones,
      courierPerformance,
    ] = await Promise.all([
      this.users.countDocuments({}),
      this.prisma.shops.count(),
      this.prisma.products.count(),
      this.prisma.orders.count(),
      this.reviews.countDocuments({}),
      this.posts.countDocuments({}),
      this.prisma.orders.aggregate({ where: { status: 'delivered' }, _sum: { total_amount: true } }),
      this.prisma.orders.groupBy({ by: ['status'], _count: true }),
      this.prisma.orders.groupBy({ by: ['payment_method', 'payment_status'], _count: true, _sum: { total_amount: true } }),
      this.users.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      // `shops` a migré vers MySQL (Phase 2) : `DATE_FORMAT` en SQL brut
      // remplace le `$dateToString`/`$group` Mongo, Prisma ne sait pas grouper
      // par expression calculée sur une date.
      this.prisma.$queryRaw<{ day: string; count: bigint }[]>`
        SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS count
        FROM shops WHERE created_at >= ${from}
        GROUP BY day ORDER BY day ASC
      `,
      // `orders`/`order_items` ont migré vers MySQL (Phase 3) : jointure SQL
      // directe plutôt que `$unwind`/`$group` Mongo.
      this.prisma.$queryRaw<{ productId: number; name: string; quantity: bigint; revenue: string }[]>`
        SELECT oi.product_id AS productId, p.name AS name,
               SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price) AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.status = 'delivered'
        GROUP BY oi.product_id, p.name
        ORDER BY quantity DESC LIMIT 10
      `,
      this.prisma.$queryRaw<{ city: string; orders: bigint }[]>`
        SELECT delivery_city AS city, COUNT(*) AS orders
        FROM orders WHERE delivery_city IS NOT NULL
        GROUP BY delivery_city ORDER BY orders DESC LIMIT 10
      `,
      this.prisma.$queryRaw<{ courierId: number; deliveries: bigint; shippingRevenue: string; tips: string; firstname: string; lastname: string; phone: string | null }[]>`
        SELECT o.courier_id AS courierId, COUNT(*) AS deliveries,
               SUM(o.shipping_fee) AS shippingRevenue, SUM(o.tip_amount) AS tips,
               u.firstname AS firstname, u.lastname AS lastname, u.phone AS phone
        FROM orders o
        LEFT JOIN users u ON u.id = o.courier_id
        WHERE o.status = 'delivered' AND o.courier_id IS NOT NULL
        GROUP BY o.courier_id, u.firstname, u.lastname, u.phone
        ORDER BY deliveries DESC LIMIT 10
      `,
    ]);

    return {
      counts: {
        users: userCount,
        shops: shopCount,
        products: productCount,
        orders: orderCount,
        reviews: reviewCount,
        posts: postCount,
      },
      revenue: revenue._sum.total_amount ?? 0,
      ordersByStatus: byStatusRows.map((row) => ({ _id: row.status, count: row._count })),
      paymentBreakdown: paymentBreakdownRows.map((row) => ({
        _id: { method: row.payment_method, status: row.payment_status },
        count: row._count,
        total: row._sum.total_amount ?? 0,
      })),
      growth: {
        periodDays: days,
        users: userGrowth,
        shops: shopGrowth.map((row) => ({ _id: row.day, count: Number(row.count) })),
      },
      topProducts: topProducts.map((row) => ({
        _id: { productId: String(row.productId), name: row.name },
        quantity: Number(row.quantity),
        revenue: Number(row.revenue),
      })),
      topZones: topZones.map((row) => ({ _id: row.city, orders: Number(row.orders) })),
      courierPerformance: courierPerformance.map((row) => ({
        _id: String(row.courierId),
        deliveries: Number(row.deliveries),
        shippingRevenue: Number(row.shippingRevenue ?? 0),
        tips: Number(row.tips ?? 0),
        courier: { firstName: row.firstname, lastName: row.lastname, phone: row.phone },
      })),
    };
  }
}
