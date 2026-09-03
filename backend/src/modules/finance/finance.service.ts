import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { CourierWithdrawal, type CourierWithdrawalDocument } from '../courier-earnings/schemas/withdrawal.schema';
import { Invoice, type InvoiceDocument, Refund, type RefundDocument } from '../orders/schemas/invoice.schema';
import { Order, type OrderDocument } from '../orders/schemas/order.schema';
import { MerchantWithdrawal, type MerchantWithdrawalDocument } from './schemas/merchant-withdrawal.schema';
import { Transaction, type TransactionDocument, type TransactionStatus, type TransactionType } from './schemas/transaction.schema';

/**
 * Commission de plateforme sur la vente elle-même (§30) — distincte de la
 * commission déjà prélevée par `CourierEarningsService` sur les frais de
 * livraison (20 %, jamais sur le pourboire). Aucune des deux ne recouvre
 * l'autre : celle-ci porte sur `amounts.subtotal` (la marchandise), l'autre
 * sur `amounts.shippingFee` (la course). Absente du cahier des charges
 * jusqu'ici — 10 % est la décision produit retenue, alignée sur les taux de
 * commission usuels des places de marché e-commerce.
 */
const PLATFORM_COMMISSION_RATE = 0.1;

@Injectable()
export class FinanceService {
  constructor(
    @InjectModel(Transaction.name) private readonly transactions: Model<TransactionDocument>,
    @InjectModel(MerchantWithdrawal.name) private readonly merchantWithdrawals: Model<MerchantWithdrawalDocument>,
    @InjectModel(CourierWithdrawal.name) private readonly courierWithdrawals: Model<CourierWithdrawalDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Invoice.name) private readonly invoices: Model<InvoiceDocument>,
    @InjectModel(Refund.name) private readonly refunds: Model<RefundDocument>,
  ) {}

  // --- Comptabilisation automatique à la livraison ------------------------

  /**
   * Dépose les deux lignes de revenu de plateforme pour une commande qui
   * vient de passer « livrée » — jamais rejouée si déjà comptabilisée
   * (`orderId` unique par type dans les faits : une commande n'est livrée
   * qu'une fois, `ORDER_TRANSITIONS` l'interdit).
   */
  async recordDeliveryRevenue(order: {
    _id: Types.ObjectId | string;
    shopId: Types.ObjectId | string;
    amounts: { subtotal: unknown; shippingFee: unknown };
  }): Promise<void> {
    const orderId = new Types.ObjectId(String(order._id));
    const shopId = new Types.ObjectId(String(order.shopId));
    const subtotal = Number(order.amounts.subtotal);
    const shippingFee = Number(order.amounts.shippingFee ?? 0);

    const existing = await this.transactions.exists({ orderId, type: { $in: ['commission', 'delivery_fee'] } });
    if (existing) return;

    const entries: Array<Record<string, unknown>> = [];
    if (subtotal > 0) {
      entries.push({
        type: 'commission',
        amount: (subtotal * PLATFORM_COMMISSION_RATE).toFixed(2),
        orderId,
        shopId,
        status: 'completed',
        note: `Commission plateforme (${PLATFORM_COMMISSION_RATE * 100}% de ${subtotal} Ar)`,
      });
    }
    if (shippingFee > 0) {
      entries.push({
        type: 'delivery_fee',
        amount: shippingFee.toFixed(2),
        orderId,
        shopId,
        status: 'completed',
        note: 'Frais de livraison encaissés',
      });
    }
    if (entries.length) await this.transactions.insertMany(entries);
  }

  // --- Transactions et paiements -------------------------------------------

  listTransactions(type?: TransactionType, status?: TransactionStatus) {
    const filter: Record<string, unknown> = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    return this.transactions.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  }

  listPayments(status?: string, method?: string) {
    const filter: Record<string, unknown> = {};
    if (status) filter['payment.status'] = status;
    if (method) filter['payment.method'] = method;
    return this.orders
      .find(filter)
      .select('orderNumber shop shopId amounts payment createdAt')
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();
  }

  // --- Résumés — commissions, revenus, frais de livraison ------------------

  private async sumByDay(type: TransactionType, from?: Date) {
    const match: Record<string, unknown> = { type, status: 'completed' };
    if (from) match.createdAt = { $gte: from };
    return this.transactions.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 90 },
    ]);
  }

  async commissionsSummary(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const [byDay, total] = await Promise.all([
      this.sumByDay('commission', from),
      this.transactions.aggregate([
        { $match: { type: 'commission', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
    ]);
    return { byDay, lifetime: total[0] ?? { total: 0, count: 0 } };
  }

  async deliveryFeesSummary(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const [byDay, total] = await Promise.all([
      this.sumByDay('delivery_fee', from),
      this.transactions.aggregate([
        { $match: { type: 'delivery_fee', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
    ]);
    return { byDay, lifetime: total[0] ?? { total: 0, count: 0 } };
  }

  /** Revenu net de plateforme = commissions + frais de livraison − remboursements. */
  async revenueSummary(days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const [commissions, deliveryFees, refundsTotal, grossSales] = await Promise.all([
      this.transactions.aggregate([
        { $match: { type: 'commission', status: 'completed', createdAt: { $gte: from } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.transactions.aggregate([
        { $match: { type: 'delivery_fee', status: 'completed', createdAt: { $gte: from } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.transactions.aggregate([
        { $match: { type: 'refund', status: 'completed', createdAt: { $gte: from } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.orders.aggregate([
        { $match: { status: 'delivered', createdAt: { $gte: from } } },
        { $group: { _id: null, total: { $sum: '$amounts.total' }, orders: { $sum: 1 } } },
      ]),
    ]);
    const commission = Number(commissions[0]?.total ?? 0);
    const delivery = Number(deliveryFees[0]?.total ?? 0);
    const refunded = Number(refundsTotal[0]?.total ?? 0);
    return {
      periodDays: days,
      grossOrderVolume: grossSales[0]?.total ?? 0,
      deliveredOrders: grossSales[0]?.orders ?? 0,
      commissionRevenue: commission,
      deliveryFeeRevenue: delivery,
      refunded,
      netPlatformRevenue: commission + delivery - refunded,
    };
  }

  // --- Remboursements -------------------------------------------------------

  refundsList(status?: string) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    return this.refunds.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  /**
   * Remboursement réel : dépose un `Refund` qualifié (montant, motif) et une
   * ligne de grand livre, puis fait basculer la commande — même transition
   * qu'`AdministrationService.refundOrder` avant cette refonte, désormais
   * réutilisée depuis un seul endroit pour ne jamais diverger.
   */
  async createRefund(orderId: string, amount: number | undefined, reason: string, createdBy: string): Promise<unknown> {
    const order = await this.orders.findById(orderId);
    if (!order) throw AppError.notFound('Commande');

    const refundAmount = amount ?? Number(order.amounts.total);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      throw new AppError('INVALID_REFUND_AMOUNT', 'Montant de remboursement invalide.', 400);
    }

    const refund = await this.refunds.create({
      orderId: order._id,
      shopId: order.shopId,
      amount: refundAmount.toFixed(2),
      reason: reason.trim(),
      status: 'completed',
      createdBy: new Types.ObjectId(createdBy),
    });

    await this.transactions.create({
      type: 'refund',
      amount: refundAmount.toFixed(2),
      orderId: order._id,
      shopId: order.shopId,
      status: 'completed',
      note: reason.trim(),
    });

    order.payment.status = 'refunded';
    order.status = 'cancelled';
    await order.save();

    return refund.toJSON();
  }

  // --- Factures ---------------------------------------------------------------

  invoicesList(shopId?: string) {
    const filter: Record<string, unknown> = {};
    if (shopId) filter.shopId = new Types.ObjectId(shopId);
    return this.invoices.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  async generateInvoice(orderId: string, issuedBy: string): Promise<unknown> {
    const order = await this.orders.findById(orderId);
    if (!order) throw AppError.notFound('Commande');
    if (order.invoiceId) throw new AppError('INVOICE_EXISTS', 'Cette commande a déjà une facture.', 409);

    const year = new Date().getUTCFullYear();
    const count = await this.invoices.countDocuments({ invoiceNumber: new RegExp(`^FAC-${year}-`) });
    const invoiceNumber = `FAC-${year}-${String(count + 1).padStart(4, '0')}`;

    const invoice = await this.invoices.create({
      invoiceNumber,
      orderId: order._id,
      shopId: order.shopId,
      userId: order.userId,
      customer: { name: order.customer.name, phone: order.customer.phone, address: order.delivery.address },
      items: order.items,
      amounts: {
        subtotal: order.amounts.subtotal,
        shippingFee: order.amounts.shippingFee,
        discount: order.amounts.discount,
        total: order.amounts.total,
      },
      status: order.payment.status === 'paid' ? 'paid' : 'issued',
      paymentMethod: order.payment.method,
      issuedAt: new Date(),
      issuedBy: new Types.ObjectId(issuedBy),
    });

    order.invoiceId = invoice._id as Types.ObjectId;
    await order.save();
    return invoice.toJSON();
  }

  // --- Retraits commerçants -----------------------------------------------------

  /** Solde retirable = commissions déduites du chiffre d'affaires livré, moins les retraits déjà honorés ou en cours. */
  async merchantBalance(shopId: string): Promise<{ lifetimeRevenue: number; withdrawn: number; balance: number }> {
    const shopObjectId = new Types.ObjectId(shopId);
    const [revenue, withdrawn] = await Promise.all([
      this.orders.aggregate([
        { $match: { shopId: shopObjectId, status: 'delivered' } },
        { $group: { _id: null, subtotal: { $sum: '$amounts.subtotal' } } },
      ]),
      this.merchantWithdrawals.aggregate([
        { $match: { shopId: shopObjectId, status: { $in: ['pending', 'paid'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);
    const subtotal = Number(revenue[0]?.subtotal ?? 0);
    const lifetimeRevenue = subtotal * (1 - PLATFORM_COMMISSION_RATE);
    const withdrawnTotal = Number(withdrawn[0]?.total ?? 0);
    return { lifetimeRevenue, withdrawn: withdrawnTotal, balance: Math.max(0, lifetimeRevenue - withdrawnTotal) };
  }

  async requestMerchantWithdrawal(shopId: string, ownerId: string, amount: number, method: string, account: string): Promise<unknown> {
    if (!Number.isFinite(amount) || amount <= 0 || !method?.trim() || !account?.trim()) {
      throw new AppError('INVALID_WITHDRAWAL', 'Montant et coordonnées de retrait invalides.', 400);
    }
    const { balance } = await this.merchantBalance(shopId);
    if (amount > balance) throw new AppError('INSUFFICIENT_BALANCE', 'Solde insuffisant.', 400);

    const withdrawal = await this.merchantWithdrawals.create({
      shopId: new Types.ObjectId(shopId),
      ownerId: new Types.ObjectId(ownerId),
      amount: amount.toFixed(2),
      method: method.trim(),
      account: account.trim(),
    });
    return withdrawal.toJSON();
  }

  listMerchantWithdrawals(shopId?: string, status?: string) {
    const filter: Record<string, unknown> = {};
    if (shopId) filter.shopId = new Types.ObjectId(shopId);
    if (status) filter.status = status;
    return this.merchantWithdrawals.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  async resolveMerchantWithdrawal(id: string, status: 'paid' | 'rejected'): Promise<unknown> {
    const withdrawal = await this.merchantWithdrawals.findByIdAndUpdate(id, { $set: { status } }, { new: true });
    if (!withdrawal) throw AppError.notFound('Retrait');
    if (status === 'paid') {
      await this.transactions.create({
        type: 'merchant_withdrawal',
        amount: withdrawal.amount,
        shopId: withdrawal.shopId,
        userId: withdrawal.ownerId,
        status: 'completed',
        note: `Retrait commerçant honoré (${withdrawal.method})`,
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
      await this.transactions.create({
        type: 'courier_withdrawal',
        amount: withdrawal.amount.toFixed ? withdrawal.amount.toFixed(2) : String(withdrawal.amount),
        userId: withdrawal.courierId,
        status: 'completed',
        note: `Retrait livreur honoré (${withdrawal.method})`,
      });
    }
    return withdrawal.toJSON();
  }

  // --- Rapports financiers consolidés ----------------------------------------

  async financialReport(from?: string, to?: string) {
    const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate = to ? new Date(to) : new Date();

    const [byType, refundsCount, merchantWithdrawalsAgg, courierWithdrawalsAgg] = await Promise.all([
      this.transactions.aggregate([
        { $match: { createdAt: { $gte: fromDate, $lte: toDate }, status: 'completed' } },
        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      this.refunds.countDocuments({ createdAt: { $gte: fromDate, $lte: toDate } }),
      this.merchantWithdrawals.aggregate([
        { $match: { createdAt: { $gte: fromDate, $lte: toDate }, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      this.courierWithdrawals.aggregate([
        { $match: { createdAt: { $gte: fromDate, $lte: toDate }, status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
    ]);

    const byTypeMap = Object.fromEntries(byType.map((row) => [row._id, { total: row.total, count: row.count }]));
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
