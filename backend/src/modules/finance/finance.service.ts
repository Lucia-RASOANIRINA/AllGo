import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Prisma } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CourierWithdrawal, type CourierWithdrawalDocument } from '../courier-earnings/schemas/withdrawal.schema';
import { MerchantWithdrawal, type MerchantWithdrawalDocument } from './schemas/merchant-withdrawal.schema';

/**
 * Commission de plateforme sur la vente elle-même (§30) — distincte de la
 * commission déjà prélevée par `CourierEarningsService` sur les frais de
 * livraison (20 %, jamais sur le pourboire). Absente du cahier des charges
 * jusqu'ici — 10 % est la décision produit retenue.
 */
const PLATFORM_COMMISSION_RATE = 0.1;

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectModel(MerchantWithdrawal.name) private readonly merchantWithdrawals: Model<MerchantWithdrawalDocument>,
    @InjectModel(CourierWithdrawal.name) private readonly courierWithdrawals: Model<CourierWithdrawalDocument>,
  ) {}

  // --- Comptabilisation automatique à la livraison ------------------------

  /**
   * Dépose les deux lignes de revenu de plateforme pour une commande qui
   * vient de passer « livrée » — jamais rejouée si déjà comptabilisée
   * (`ORDER_TRANSITIONS` interdit de repasser une commande par `delivered`).
   */
  async recordDeliveryRevenue(orderId: number): Promise<void> {
    const existing = await this.prisma.transactions.findFirst({
      where: { order_id: orderId, type: { in: ['commission', 'delivery_fee'] } },
    });
    if (existing) return;

    const order = await this.prisma.orders.findUnique({
      where: { id: orderId },
      include: { order_items: true },
    });
    if (!order) return;

    const subtotal = order.order_items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0);
    const shippingFee = Number(order.shipping_fee ?? 0);

    const entries: Prisma.transactionsCreateManyInput[] = [];
    if (subtotal > 0) {
      entries.push({
        type: 'commission',
        amount: (subtotal * PLATFORM_COMMISSION_RATE).toFixed(2),
        order_id: orderId,
        shop_id: order.shop_id,
        status: 'completed',
        note: `Commission plateforme (${PLATFORM_COMMISSION_RATE * 100}% de ${subtotal} Ar)`,
      });
    }
    if (shippingFee > 0) {
      entries.push({
        type: 'delivery_fee',
        amount: shippingFee.toFixed(2),
        order_id: orderId,
        shop_id: order.shop_id,
        status: 'completed',
        note: 'Frais de livraison encaissés',
      });
    }
    if (entries.length) await this.prisma.transactions.createMany({ data: entries });
  }

  // --- Transactions et paiements -------------------------------------------

  listTransactions(type?: string, status?: string) {
    return this.prisma.transactions.findMany({
      where: { type: type as never, status: status as never },
      orderBy: { created_at: 'desc' },
      take: 300,
    });
  }

  listPayments(status?: string, method?: string) {
    return this.prisma.payments.findMany({
      where: { status: status as never, method },
      include: { orders: { select: { order_number: true, shop_id: true } } },
      orderBy: { created_at: 'desc' },
      take: 300,
    });
  }

  // --- Résumés — commissions, revenus, frais de livraison ------------------

  private async sumByDay(type: Prisma.transactionsWhereInput['type'], from?: Date) {
    const rows = await this.prisma.$queryRaw<{ day: string; total: string; count: bigint }[]>`
      SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, SUM(amount) AS total, COUNT(*) AS count
      FROM transactions
      WHERE type = ${type} AND status = 'completed' ${from ? Prisma.sql`AND created_at >= ${from}` : Prisma.empty}
      GROUP BY day ORDER BY day DESC LIMIT 90
    `;
    return rows.map((r) => ({ _id: r.day, total: Number(r.total), count: Number(r.count) }));
  }

  async commissionsSummary(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const [byDay, total] = await Promise.all([
      this.sumByDay('commission', from),
      this.prisma.transactions.aggregate({ where: { type: 'commission', status: 'completed' }, _sum: { amount: true }, _count: true }),
    ]);
    return { byDay, lifetime: { total: total._sum.amount ?? 0, count: total._count } };
  }

  async deliveryFeesSummary(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const [byDay, total] = await Promise.all([
      this.sumByDay('delivery_fee', from),
      this.prisma.transactions.aggregate({ where: { type: 'delivery_fee', status: 'completed' }, _sum: { amount: true }, _count: true }),
    ]);
    return { byDay, lifetime: { total: total._sum.amount ?? 0, count: total._count } };
  }

  /** Revenu net de plateforme = commissions + frais de livraison − remboursements. */
  async revenueSummary(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const [commissions, deliveryFees, refundsTotal, grossSales] = await Promise.all([
      this.prisma.transactions.aggregate({ where: { type: 'commission', status: 'completed', created_at: { gte: from } }, _sum: { amount: true } }),
      this.prisma.transactions.aggregate({ where: { type: 'delivery_fee', status: 'completed', created_at: { gte: from } }, _sum: { amount: true } }),
      this.prisma.transactions.aggregate({ where: { type: 'refund', status: 'completed', created_at: { gte: from } }, _sum: { amount: true } }),
      this.prisma.orders.aggregate({ where: { status: 'delivered', created_at: { gte: from } }, _sum: { total_amount: true }, _count: true }),
    ]);
    const commission = Number(commissions._sum.amount ?? 0);
    const delivery = Number(deliveryFees._sum.amount ?? 0);
    const refunded = Number(refundsTotal._sum.amount ?? 0);
    return {
      periodDays: days,
      grossOrderVolume: grossSales._sum.total_amount ?? 0,
      deliveredOrders: grossSales._count,
      commissionRevenue: commission,
      deliveryFeeRevenue: delivery,
      refunded,
      netPlatformRevenue: commission + delivery - refunded,
    };
  }

  // --- Remboursements -------------------------------------------------------

  refundsList(status?: string) {
    return this.prisma.refunds.findMany({ where: { status: status as never }, orderBy: { created_at: 'desc' }, take: 200 });
  }

  /**
   * Remboursement réel : dépose une ligne `refunds` qualifiée (montant,
   * motif) et une ligne de grand livre, puis fait basculer la commande.
   */
  async createRefund(orderId: string, amount: number | undefined, reason: string, createdByMysqlId: number): Promise<unknown> {
    const order = await this.prisma.orders.findUnique({ where: { id: Number(orderId) } });
    if (!order) throw AppError.notFound('Commande');

    const refundAmount = amount ?? Number(order.total_amount);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      throw new AppError('INVALID_REFUND_AMOUNT', 'Montant de remboursement invalide.', 400);
    }

    const refund = await this.prisma.refunds.create({
      data: {
        order_id: order.id,
        shop_id: order.shop_id,
        requested_by: createdByMysqlId,
        amount: refundAmount,
        reason: reason.trim(),
        status: 'approved',
      },
    });

    await this.prisma.transactions.create({
      data: {
        type: 'refund',
        amount: refundAmount,
        order_id: order.id,
        shop_id: order.shop_id,
        status: 'completed',
        note: reason.trim(),
      },
    });

    await this.prisma.orders.update({ where: { id: order.id }, data: { payment_status: 'refunded', status: 'cancelled' } });

    return refund;
  }

  // --- Factures ---------------------------------------------------------------

  invoicesList(shopId?: string) {
    return this.prisma.sales_invoices.findMany({
      where: shopId ? { shop_id: Number(shopId) } : {},
      orderBy: { created_at: 'desc' },
      take: 200,
    });
  }

  async generateInvoice(orderId: string, issuedByMysqlId: number): Promise<unknown> {
    const order = await this.prisma.orders.findUnique({ where: { id: Number(orderId) } });
    if (!order) throw AppError.notFound('Commande');

    const existing = await this.prisma.sales_invoices.findFirst({ where: { order_id: order.id } });
    if (existing) throw new AppError('INVOICE_EXISTS', 'Cette commande a déjà une facture.', 409);

    const year = new Date().getUTCFullYear();
    const count = await this.prisma.sales_invoices.count({ where: { invoice_number: { startsWith: `FAC-${year}-` } } });
    const invoiceNumber = `FAC-${year}-${String(count + 1).padStart(4, '0')}`;

    return this.prisma.sales_invoices.create({
      data: {
        invoice_number: invoiceNumber,
        order_id: order.id,
        shop_id: order.shop_id,
        client_id: order.user_id,
        cashier_id: issuedByMysqlId,
        amount: order.total_amount,
        payment_method: order.payment_method,
        status: order.payment_status === 'paid' ? 'paid' : 'draft',
        paid_at: order.payment_status === 'paid' ? new Date() : undefined,
        sent_at: new Date(),
      },
    });
  }

  // --- Retraits commerçants (Mongo, pas encore migré — Phase 5) -----------------

  /** Solde retirable = commissions déduites du chiffre d'affaires livré, moins les retraits déjà honorés ou en cours. */
  async merchantBalance(shopId: string): Promise<{ lifetimeRevenue: number; withdrawn: number; balance: number }> {
    const id = Number(shopId);
    const [revenue, withdrawn] = await Promise.all([
      this.prisma.orders.aggregate({ where: { shop_id: id, status: 'delivered' }, _sum: { total_amount: true } }),
      this.merchantWithdrawals.aggregate([
        { $match: { shopId: id, status: { $in: ['pending', 'paid'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);
    const subtotal = Number(revenue._sum.total_amount ?? 0);
    const lifetimeRevenue = subtotal * (1 - PLATFORM_COMMISSION_RATE);
    const withdrawnTotal = Number(withdrawn[0]?.total ?? 0);
    return { lifetimeRevenue, withdrawn: withdrawnTotal, balance: Math.max(0, lifetimeRevenue - withdrawnTotal) };
  }

  async requestMerchantWithdrawal(shopId: string, ownerMysqlId: number, amount: number, method: string, account: string): Promise<unknown> {
    if (!Number.isFinite(amount) || amount <= 0 || !method?.trim() || !account?.trim()) {
      throw new AppError('INVALID_WITHDRAWAL', 'Montant et coordonnées de retrait invalides.', 400);
    }
    const { balance } = await this.merchantBalance(shopId);
    if (amount > balance) throw new AppError('INSUFFICIENT_BALANCE', 'Solde insuffisant.', 400);

    const withdrawal = await this.merchantWithdrawals.create({
      shopId: Number(shopId),
      ownerId: ownerMysqlId,
      amount: amount.toFixed(2),
      method: method.trim(),
      account: account.trim(),
    });
    return withdrawal.toJSON();
  }

  listMerchantWithdrawals(shopId?: string, status?: string) {
    const filter: Record<string, unknown> = {};
    if (shopId) filter.shopId = Number(shopId);
    if (status) filter.status = status;
    return this.merchantWithdrawals.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  async resolveMerchantWithdrawal(id: string, status: 'paid' | 'rejected'): Promise<unknown> {
    const withdrawal = await this.merchantWithdrawals.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!withdrawal) throw AppError.notFound('Retrait');
    if (status === 'paid') {
      await this.prisma.transactions.create({
        data: {
          type: 'merchant_withdrawal',
          amount: withdrawal.amount as never,
          shop_id: withdrawal.shopId,
          status: 'completed',
          note: `Retrait commerçant honoré (${withdrawal.method})`,
        },
      });
    }
    return withdrawal.toJSON();
  }

  // --- Retraits livreurs (vue et approbation admin) --------------------------

  listCourierWithdrawals(status?: string) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    return this.courierWithdrawals.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  async resolveCourierWithdrawal(id: string, status: 'paid' | 'rejected'): Promise<unknown> {
    const withdrawal = await this.courierWithdrawals.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!withdrawal) throw AppError.notFound('Retrait');
    if (status === 'paid') {
      await this.prisma.transactions.create({
        data: {
          type: 'courier_withdrawal',
          amount: withdrawal.amount,
          status: 'completed',
          note: `Retrait livreur honoré (${withdrawal.method})`,
        },
      });
    }
    return withdrawal.toJSON();
  }

  // --- Rapports financiers consolidés ----------------------------------------

  async financialReport(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate = to ? new Date(to) : new Date();

    const [byType, refundsCount, merchantWithdrawalsAgg, courierWithdrawalsAgg] = await Promise.all([
      this.prisma.transactions.groupBy({
        by: ['type'],
        where: { created_at: { gte: fromDate, lte: toDate }, status: 'completed' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.refunds.count({ where: { created_at: { gte: fromDate, lte: toDate } } }),
      this.merchantWithdrawals.aggregate([
        { $match: { createdAt: { $gte: fromDate, $lte: toDate }, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      this.courierWithdrawals.aggregate([
        { $match: { createdAt: { $gte: fromDate, $lte: toDate }, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
    ]);

    const byTypeMap = Object.fromEntries(byType.map((row) => [row.type, { total: row._sum.amount ?? 0, count: row._count }]));
    return {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      byType: byTypeMap,
      refundsIssued: refundsCount,
      merchantWithdrawalsPaid: merchantWithdrawalsAgg[0] ?? { total: 0, count: 0 },
      courierWithdrawalsPaid: courierWithdrawalsAgg[0] ?? { total: 0, count: 0 },
    };
  }
}
