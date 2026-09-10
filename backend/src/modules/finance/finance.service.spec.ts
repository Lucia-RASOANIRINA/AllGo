import { AppError } from '../../common/http/app-error';
import { FinanceService } from './finance.service';

/**
 * 100 % MySQL depuis la Phase 6 (`transactions`/`orders`/`refunds`/
 * `sales_invoices`/`merchant_withdrawals`/`courier_withdrawals`) — plus
 * aucune dépendance à une infrastructure réelle, ce test est un simple test
 * unitaire (`npm test`), plus une intégration Mongo dédiée.
 */
describe('FinanceService', () => {
  let service: FinanceService;
  let prisma: {
    orders: { findUnique: jest.Mock; aggregate: jest.Mock; update: jest.Mock };
    transactions: { findFirst: jest.Mock; findMany: jest.Mock; createMany: jest.Mock; create: jest.Mock; aggregate: jest.Mock; groupBy: jest.Mock };
    payments: { findMany: jest.Mock };
    refunds: { findMany: jest.Mock; create: jest.Mock; count: jest.Mock };
    sales_invoices: { findMany: jest.Mock; findFirst: jest.Mock; count: jest.Mock; create: jest.Mock };
    merchant_withdrawals: { findMany: jest.Mock; create: jest.Mock; update: jest.Mock; aggregate: jest.Mock };
    courier_withdrawals: { findMany: jest.Mock; create: jest.Mock; update: jest.Mock; aggregate: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      orders: { findUnique: jest.fn(), aggregate: jest.fn(), update: jest.fn() },
      transactions: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null }, _count: 0 }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      payments: { findMany: jest.fn().mockResolvedValue([]) },
      refunds: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      sales_invoices: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      merchant_withdrawals: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null }, _count: 0 }),
      },
      courier_withdrawals: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null }, _count: 0 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new FinanceService(prisma as never);
  });

  function order(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      shop_id: 10,
      user_id: 20,
      total_amount: '2500.00',
      shipping_fee: '500.00',
      payment_status: 'unpaid',
      status: 'shipped',
      order_items: [{ unit_price: '1000.00', quantity: 2 }],
      ...overrides,
    };
  }

  describe('recordDeliveryRevenue', () => {
    it('dépose une ligne de commission (10% du sous-total) et une ligne de frais de livraison', async () => {
      prisma.orders.findUnique.mockResolvedValue(order());
      await service.recordDeliveryRevenue(1);

      expect(prisma.transactions.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ type: 'commission', amount: '200.00', order_id: 1, shop_id: 10 }),
          expect.objectContaining({ type: 'delivery_fee', amount: '500.00', order_id: 1, shop_id: 10 }),
        ],
      });
    });

    it('est idempotent — ne dépose rien de plus si une ligne existe déjà pour cette commande', async () => {
      prisma.transactions.findFirst.mockResolvedValue({ id: 99 });
      await service.recordDeliveryRevenue(1);
      expect(prisma.orders.findUnique).not.toHaveBeenCalled();
      expect(prisma.transactions.createMany).not.toHaveBeenCalled();
    });

    it("n'insère aucune ligne de commission quand le sous-total est nul", async () => {
      prisma.orders.findUnique.mockResolvedValue(order({ order_items: [], shipping_fee: '500.00' }));
      await service.recordDeliveryRevenue(1);
      const entries = prisma.transactions.createMany.mock.calls[0][0].data;
      expect(entries.map((e: any) => e.type)).toEqual(['delivery_fee']);
    });

    it('ne fait rien si la commande est introuvable', async () => {
      prisma.orders.findUnique.mockResolvedValue(null);
      await service.recordDeliveryRevenue(999);
      expect(prisma.transactions.createMany).not.toHaveBeenCalled();
    });
  });

  describe('createRefund', () => {
    it('dépose un remboursement qualifié, une ligne de grand livre, et bascule la commande', async () => {
      prisma.orders.findUnique.mockResolvedValue(order({ payment_status: 'paid' }));
      prisma.refunds.create.mockResolvedValue({ id: 1, amount: '2500.00', status: 'approved' });

      const refund: any = await service.createRefund('1', undefined, 'Produit non conforme', 5);

      expect(prisma.refunds.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ order_id: 1, shop_id: 10, requested_by: 5, amount: 2500, status: 'approved' }),
      });
      expect(prisma.transactions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'refund', amount: 2500, order_id: 1, shop_id: 10 }),
      });
      expect(prisma.orders.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { payment_status: 'refunded', status: 'cancelled' },
      });
      expect(refund.amount).toBe('2500.00');
    });

    it('accepte un remboursement partiel avec un montant explicite', async () => {
      prisma.orders.findUnique.mockResolvedValue(order({ payment_status: 'paid' }));
      await service.createRefund('1', 1000, 'Article manquant', 5);
      expect(prisma.refunds.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 1000 }) });
    });

    it('refuse un montant de remboursement invalide', async () => {
      prisma.orders.findUnique.mockResolvedValue(order());
      await expect(service.createRefund('1', -5, 'x', 5)).rejects.toThrow(AppError);
    });

    it('une commande introuvable est un 404 explicite', async () => {
      prisma.orders.findUnique.mockResolvedValue(null);
      await expect(service.createRefund('999', undefined, 'x', 5)).rejects.toThrow(AppError);
    });
  });

  describe('generateInvoice', () => {
    it('génère une facture numérotée à partir de la commande', async () => {
      prisma.orders.findUnique.mockResolvedValue(order({ payment_status: 'paid' }));
      prisma.sales_invoices.count.mockResolvedValue(0);
      prisma.sales_invoices.create.mockImplementation(({ data }) => Promise.resolve(data));

      const invoice: any = await service.generateInvoice('1', 5);
      expect(invoice.invoice_number).toMatch(/^FAC-\d{4}-0001$/);
      expect(invoice.status).toBe('paid');
    });

    it('refuse une seconde facture pour la même commande', async () => {
      prisma.orders.findUnique.mockResolvedValue(order());
      prisma.sales_invoices.findFirst.mockResolvedValue({ id: 1 });
      await expect(service.generateInvoice('1', 5)).rejects.toThrow('déjà une facture');
    });
  });

  describe('retraits commerçants', () => {
    it('le solde retirable est le chiffre d’affaires livré net de commission, moins les retraits en cours', async () => {
      prisma.orders.aggregate.mockResolvedValue({ _sum: { total_amount: 10000 } });
      prisma.merchant_withdrawals.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const before = await service.merchantBalance('10');
      expect(before.balance).toBeCloseTo(9000); // 10000 * (1 - 10%)

      prisma.merchant_withdrawals.aggregate.mockResolvedValue({ _sum: { amount: 3000 } });
      const after = await service.merchantBalance('10');
      expect(after.balance).toBeCloseTo(6000);
    });

    it('refuse une demande qui dépasse le solde disponible', async () => {
      prisma.orders.aggregate.mockResolvedValue({ _sum: { total_amount: 1000 } });
      await expect(service.requestMerchantWithdrawal('10', 3, 5000, 'mobile_money', '+261340000001')).rejects.toThrow(
        'Solde insuffisant',
      );
    });

    it('honorer un retrait dépose une ligne de grand livre ; le rejeter n’en dépose aucune', async () => {
      prisma.orders.aggregate.mockResolvedValue({ _sum: { total_amount: 10000 } });
      prisma.merchant_withdrawals.create.mockResolvedValue({ id: 1, shop_id: 10, owner_id: 3, amount: '1000.00', method: 'mobile_money', account: 'x', status: 'pending', created_at: new Date(), updated_at: null });
      await service.requestMerchantWithdrawal('10', 3, 1000, 'mobile_money', '+261340000001');

      prisma.merchant_withdrawals.update.mockResolvedValue({ id: 1, shop_id: 10, owner_id: 3, amount: '1000.00', method: 'mobile_money', account: 'x', status: 'paid', created_at: new Date(), updated_at: null });
      await service.resolveMerchantWithdrawal('1', 'paid');
      expect(prisma.transactions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'merchant_withdrawal', shop_id: 10 }),
      });

      prisma.transactions.create.mockClear();
      prisma.merchant_withdrawals.update.mockResolvedValue({ id: 2, shop_id: 10, owner_id: 3, amount: '1000.00', method: 'mobile_money', account: 'x', status: 'rejected', created_at: new Date(), updated_at: null });
      await service.resolveMerchantWithdrawal('2', 'rejected');
      expect(prisma.transactions.create).not.toHaveBeenCalled();
    });
  });

  describe('retraits livreurs (approbation admin)', () => {
    it('honorer un retrait livreur dépose une ligne de grand livre', async () => {
      prisma.courier_withdrawals.update.mockResolvedValue({ id: 1, courier_id: 7, amount: '5000.00', method: 'mobile_money', account: 'x', status: 'paid', created_at: new Date(), updated_at: null });
      await service.resolveCourierWithdrawal('1', 'paid');
      expect(prisma.transactions.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'courier_withdrawal' }),
      });
    });

    it('un retrait introuvable est un 404 explicite', async () => {
      prisma.courier_withdrawals.update.mockRejectedValue(new Error('not found'));
      await expect(service.resolveCourierWithdrawal('999', 'paid')).rejects.toThrow(AppError);
    });
  });

  describe('résumés et rapports', () => {
    it('revenueSummary combine commissions, frais de livraison et remboursements sur la période', async () => {
      prisma.transactions.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 1000 } }) // commission
        .mockResolvedValueOnce({ _sum: { amount: 1000 } }) // delivery_fee
        .mockResolvedValueOnce({ _sum: { amount: 500 } }); // refund
      prisma.orders.aggregate.mockResolvedValue({ _sum: { total_amount: 11000 }, _count: 1 });

      const summary = await service.revenueSummary();
      expect(summary.commissionRevenue).toBe(1000);
      expect(summary.deliveryFeeRevenue).toBe(1000);
      expect(summary.refunded).toBe(500);
      expect(summary.netPlatformRevenue).toBe(1500);
    });

    it('financialReport regroupe les mouvements complétés par type sur la période', async () => {
      prisma.transactions.groupBy.mockResolvedValue([
        { type: 'commission', _sum: { amount: 200 }, _count: 1 },
        { type: 'delivery_fee', _sum: { amount: 500 }, _count: 1 },
      ]);

      const report = await service.financialReport();
      expect(report.byType.commission.count).toBe(1);
      expect(report.byType.delivery_fee.count).toBe(1);
    });
  });
});
