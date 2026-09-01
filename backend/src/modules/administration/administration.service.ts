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

@Injectable()
export class AdministrationService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Dispute.name) private readonly disputes: Model<DisputeDocument>,
    private readonly courierEarnings: CourierEarningsService,
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
  async refundOrder(id: string) {
    const order = await this.orders.findByIdAndUpdate(id, { $set: { 'payment.status': 'refunded', status: 'cancelled' } }, { new: true });
    if (!order) throw AppError.notFound('Commande');
    return order;
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
}
