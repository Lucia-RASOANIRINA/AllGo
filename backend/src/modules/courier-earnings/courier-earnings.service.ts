import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CourierWithdrawal, type CourierWithdrawalDocument } from './schemas/withdrawal.schema';
import { CourierBonus, type CourierBonusDocument } from './schemas/bonus.schema';

const COMMISSION_RATE = 0.2;

@Injectable()
export class CourierEarningsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectModel(CourierWithdrawal.name) private readonly withdrawals: Model<CourierWithdrawalDocument>,
    @InjectModel(CourierBonus.name) private readonly bonuses: Model<CourierBonusDocument>,
  ) {}

  async summary(courierId: number): Promise<Record<string, unknown>> {
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

  /**
   * Bonus accordé par la modération plateforme — jamais par le livreur
   * lui-même, d'où l'absence de route dans ce contrôleur (elle vit côté
   * `AdministrationController`, qui seul détient `Permission.PlatformModerate`).
   */
  async grantBonus(courierId: number, amount: number, reason: string, grantedByMysqlId: number): Promise<unknown> {
    if (!Number.isFinite(amount) || amount <= 0 || !reason?.trim()) {
      throw new AppError('INVALID_BONUS', 'Montant et motif de bonus invalides.', 400);
    }
    const bonus = await this.bonuses.create({
      courierId,
      amount,
      reason: reason.trim(),
      grantedBy: grantedByMysqlId,
    });
    return bonus.toJSON();
  }

  async history(courierId: number): Promise<unknown[]> {
    const rows = await this.prisma.orders.findMany({
      where: { courier_id: courierId, status: 'delivered' },
      orderBy: { updated_at: 'desc' },
      take: 100,
      select: {
        order_number: true, shipping_fee: true, updated_at: true, shop_id: true,
        delivery_workflow_status: true, shops: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      orderNumber: r.order_number,
      shippingFee: r.shipping_fee,
      updatedAt: r.updated_at,
      shop: { name: r.shops.name },
      workflowStatus: r.delivery_workflow_status,
    }));
  }

  async withdrawalsList(courierId: number): Promise<unknown[]> {
    return this.withdrawals.find({ courierId }).sort({ createdAt: -1 }).limit(100).lean();
  }

  async requestWithdrawal(courierId: number, amount: number, method: string, account: string): Promise<unknown> {
    if (!Number.isFinite(amount) || amount <= 0 || !method?.trim() || !account?.trim()) {
      throw new AppError('INVALID_WITHDRAWAL', 'Montant et coordonnées de retrait invalides.', 400);
    }
    const summary = await this.summary(courierId);
    if (amount > Number(summary.balance)) throw new AppError('INSUFFICIENT_BALANCE', 'Solde insuffisant.', 400);
    return this.withdrawals.create({ courierId, amount, method: method.trim(), account: account.trim() });
  }

  private async aggregate(courierId: number, from?: Date) {
    const [deliveries, bonusRow] = await Promise.all([
      this.prisma.orders.findMany({
        where: { courier_id: courierId, status: 'delivered', ...(from ? { updated_at: { gte: from } } : {}) },
        select: { shipping_fee: true, tip_amount: true },
      }),
      this.bonuses.aggregate([
        { $match: { courierId, ...(from ? { createdAt: { $gte: from } } : {}) } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    const gross = deliveries.reduce((sum, o) => sum + Number(o.shipping_fee ?? 0), 0);
    // La commission de plateforme porte sur les frais de livraison, jamais
    // sur le pourboire ni sur un bonus accordé par la modération : ces deux
    // montants reviennent intégralement au livreur.
    const commission = gross * COMMISSION_RATE;
    const tips = deliveries.reduce((sum, o) => sum + Number(o.tip_amount ?? 0), 0);
    const bonuses = Number(bonusRow[0]?.total ?? 0);

    return {
      total: gross - commission + tips + bonuses,
      deliveries: deliveries.length,
      commissions: commission,
      bonuses,
      tips,
    };
  }
}
