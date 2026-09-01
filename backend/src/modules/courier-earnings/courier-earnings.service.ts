import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppError } from '../../common/http/app-error';
import { Order, type OrderDocument } from '../orders/schemas/order.schema';
import { CourierWithdrawal, type CourierWithdrawalDocument } from './schemas/withdrawal.schema';

const COMMISSION_RATE = 0.2;

@Injectable()
export class CourierEarningsService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(CourierWithdrawal.name) private readonly withdrawals: Model<CourierWithdrawalDocument>,
  ) {}

  async summary(userId: string): Promise<Record<string, unknown>> {
    const courierId = new Types.ObjectId(userId);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - ((startOfDay.getDay() + 6) % 7));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [day, week, month, lifetime, pendingWithdrawals] = await Promise.all([
      this.aggregate(courierId, startOfDay),
      this.aggregate(courierId, startOfWeek),
      this.aggregate(courierId, startOfMonth),
      this.aggregate(courierId),
      this.withdrawals.aggregate([
        { $match: { courierId, status: { $in: ['pending', 'paid'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);
    const pending = pendingWithdrawals[0]?.total ?? 0;
    return {
      today: day,
      week,
      month,
      balance: Math.max(0, lifetime.total - pending),
      pendingWithdrawals: pending,
    };
  }

  async history(userId: string): Promise<unknown[]> {
    return this.orders.find({ 'delivery.courierId': new Types.ObjectId(userId), status: 'delivered' })
      .sort({ updatedAt: -1 }).limit(100)
      .select('orderNumber amounts.shippingFee updatedAt shop delivery.workflowStatus').lean();
  }

  async withdrawalsList(userId: string): Promise<unknown[]> {
    return this.withdrawals.find({ courierId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).limit(100).lean();
  }

  async requestWithdrawal(userId: string, amount: number, method: string, account: string): Promise<unknown> {
    if (!Number.isFinite(amount) || amount <= 0 || !method?.trim() || !account?.trim()) {
      throw new AppError('INVALID_WITHDRAWAL', 'Montant et coordonnées de retrait invalides.', 400);
    }
    const summary = await this.summary(userId);
    if (amount > Number(summary.balance)) throw new AppError('INSUFFICIENT_BALANCE', 'Solde insuffisant.', 400);
    return this.withdrawals.create({ courierId: new Types.ObjectId(userId), amount, method: method.trim(), account: account.trim() });
  }

  private async aggregate(courierId: Types.ObjectId, from?: Date) {
    const match: Record<string, unknown> = { 'delivery.courierId': courierId, status: 'delivered' };
    if (from) match.updatedAt = { $gte: from };
    const [row] = await this.orders.aggregate([
      { $match: match },
      { $project: { shipping: { $toDouble: '$amounts.shippingFee' } } },
      { $group: { _id: null, deliveries: { $sum: 1 }, gross: { $sum: '$shipping' } } },
    ]);
    const gross = Number(row?.gross ?? 0);
    const commission = gross * COMMISSION_RATE;
    return { total: gross - commission, deliveries: row?.deliveries ?? 0, commissions: commission, bonuses: 0, tips: 0 };
  }
}
