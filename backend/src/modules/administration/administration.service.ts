import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppError } from '../../common/http/app-error';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Order, type OrderDocument } from '../orders/schemas/order.schema';
import { Dispute, type DisputeDocument, type DisputeStatus } from '../orders/schemas/dispute.schema';
import { CourierEarningsService } from '../courier-earnings/courier-earnings.service';
import { FinanceService } from '../finance/finance.service';
import { Review, type ReviewDocument } from '../reviews/schemas/review.schema';
import { Post, type PostDocument } from '../social/schemas/post.schema';

@Injectable()
export class AdministrationService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Dispute.name) private readonly disputes: Model<DisputeDocument>,
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    @InjectModel(Post.name) private readonly posts: Model<PostDocument>,
    private readonly courierEarnings: CourierEarningsService,
    private readonly finance: FinanceService,
  ) {}

  usersList(status?: string) {
    return this.users.find(status ? { status } : {}).select('phone email firstName lastName avatar status roles courierProfile createdAt').sort({ createdAt: -1 }).limit(200).lean();
  }
  async updateUser(id: string, patch: { status?: 'active' | 'suspended' | 'pending'; roles?: unknown[] }) {
    if (!Types.ObjectId.isValid(id)) throw AppError.notFound('Utilisateur');
    const user = await this.users.findByIdAndUpdate(id, { $set: patch }, { new: true }).select('phone firstName lastName status roles');
    if (!user) throw AppError.notFound('Utilisateur');
    return user;
  }
  async removeUser(id: string) {
    const result = await this.users.updateOne({ _id: id }, { $set: { status: 'suspended' } });
    if (!result.modifiedCount) throw AppError.notFound('Utilisateur');
    return { deleted: true, suspended: true };
  }
  shopsList(status?: string) {
    return this.shops.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).lean();
  }
  async updateShop(id: string, status: 'pending' | 'approved' | 'rejected' | 'suspended') {
    const shop = await this.shops.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!shop) throw AppError.notFound('Boutique');
    return shop;
  }
  productsList(status?: string) {
    return this.products.find(status ? { status } : {}).select('name shopId categoryId price promoPrice stock status isHidden createdAt').sort({ createdAt: -1 }).limit(200).lean();
  }
  async moderateProduct(id: string, status: 'draft' | 'published' | 'archived', isHidden?: boolean) {
    const product = await this.products.findByIdAndUpdate(id, { $set: { status, ...(isHidden === undefined ? {} : { isHidden }) } }, { new: true });
    if (!product) throw AppError.notFound('Produit');
    return product;
  }
  async removeProduct(id: string) {
    const result = await this.products.updateOne({ _id: id }, { $set: { status: 'archived', isHidden: true } });
    if (!result.modifiedCount) throw AppError.notFound('Produit');
    return { deleted: true, archived: true };
  }
  reportedProducts() {
    return this.products.find({ isReported: true }).sort({ updatedAt: -1 }).limit(200).lean();
  }
  ordersList(status?: string) {
    return this.orders.find(status ? { status } : {}).select('orderNumber userId shopId amounts payment status delivery createdAt updatedAt').sort({ createdAt: -1 }).limit(300).lean();
  }
  /** Délègue à `FinanceService` (§30) : un remboursement dépose désormais un `Refund` qualifié et une ligne de grand livre, jamais une simple bascule de statut. */
  refundOrder(id: string, resolvedBy: string) {
    return this.finance.createRefund(id, undefined, 'Remboursement administratif', resolvedBy);
  }

  disputesList(status?: string) {
    return this.disputes.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).lean();
  }

  async resolveDispute(id: string, status: DisputeStatus, resolution: string | undefined, resolvedBy: string) {
    const dispute = await this.disputes.findByIdAndUpdate(
      id,
      { $set: { status, resolution, resolvedBy: new Types.ObjectId(resolvedBy), resolvedAt: new Date() } },
      { new: true },
    );
    if (!dispute) throw AppError.notFound('Litige');
    return dispute;
  }

  grantCourierBonus(courierId: string, amount: number, reason: string, grantedBy: string) {
    return this.courierEarnings.grantBonus(courierId, amount, reason, grantedBy);
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
      byStatus,
      paymentBreakdown,
      userGrowth,
      shopGrowth,
      topProducts,
      topZones,
      courierPerformance,
    ] = await Promise.all([
      this.users.countDocuments({}),
      this.shops.countDocuments({}),
      this.products.countDocuments({}),
      this.orders.countDocuments({}),
      this.reviews.countDocuments({}),
      this.posts.countDocuments({}),
      this.orders.aggregate([
        { $match: { status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$amounts.total' } } },
      ]),
      this.orders.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      this.orders.aggregate([
        { $group: { _id: { method: '$payment.method', status: '$payment.status' }, count: { $sum: 1 }, total: { $sum: '$amounts.total' } } },
      ]),
      this.users.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      this.shops.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: { _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      this.orders.aggregate([
        { $match: { status: 'delivered' } },
        { $unwind: '$items' },
        { $group: { _id: { productId: '$items.productId', name: '$items.name' }, quantity: { $sum: '$items.quantity' }, revenue: { $sum: '$items.subtotal' } } },
        { $sort: { quantity: -1 } },
        { $limit: 10 },
      ]),
      this.orders.aggregate([
        { $match: { 'delivery.city': { $ne: null } } },
        { $group: { _id: '$delivery.city', orders: { $sum: 1 } } },
        { $sort: { orders: -1 } },
        { $limit: 10 },
      ]),
      this.orders.aggregate([
        { $match: { status: 'delivered', 'delivery.courierId': { $ne: null } } },
        {
          $group: {
            _id: '$delivery.courierId',
            deliveries: { $sum: 1 },
            shippingRevenue: { $sum: '$amounts.shippingFee' },
            tips: { $sum: { $ifNull: ['$delivery.tip', 0] } },
          },
        },
        { $sort: { deliveries: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'courier',
            pipeline: [{ $project: { firstName: 1, lastName: 1, phone: 1 } }],
          },
        },
        { $unwind: { path: '$courier', preserveNullAndEmptyArrays: true } },
      ]),
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
      revenue: revenue[0]?.total ?? 0,
      ordersByStatus: byStatus,
      paymentBreakdown,
      growth: { periodDays: days, users: userGrowth, shops: shopGrowth },
      topProducts,
      topZones,
      courierPerformance,
    };
  }
}
