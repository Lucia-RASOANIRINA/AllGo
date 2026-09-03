import mongoose, { Connection, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { CourierWithdrawal, CourierWithdrawalSchema } from '../courier-earnings/schemas/withdrawal.schema';
import { Invoice, InvoiceSchema, Refund, RefundSchema } from '../orders/schemas/invoice.schema';
import { Order, OrderSchema } from '../orders/schemas/order.schema';
import { FinanceService } from './finance.service';
import { MerchantWithdrawal, MerchantWithdrawalSchema } from './schemas/merchant-withdrawal.schema';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';

/**
 * **Test d'intégration** — exige MongoDB en service, même motif que
 * `moderation.integration-spec.ts` : la logique de ce service tient dans ses
 * requêtes et agrégations MongoDB (Decimal128, `$sum` sur des sous-documents,
 * idempotence par requête d'existence) — la simuler avec des modèles
 * factices retesterait les mocks, pas le service. `npm run test:integration`,
 * pas `npm test`. Base dédiée (`allgo_test_finance`), jamais `allgo`.
 */
describe('FinanceService (intégration Mongo)', () => {
  let connection: Connection;
  let service: FinanceService;

  let transactions: mongoose.Model<any>;
  let merchantWithdrawals: mongoose.Model<any>;
  let courierWithdrawals: mongoose.Model<any>;
  let orders: mongoose.Model<any>;
  let invoices: mongoose.Model<any>;
  let refunds: mongoose.Model<any>;

  beforeAll(async () => {
    const base = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/allgo?replicaSet=rs0&directConnection=true';
    const testUri = base.replace(/\/[^/?]+(\?|$)/, '/allgo_test_finance$1');
    connection = mongoose.createConnection(testUri);
    await connection.asPromise();

    transactions = connection.model(Transaction.name, TransactionSchema);
    merchantWithdrawals = connection.model(MerchantWithdrawal.name, MerchantWithdrawalSchema);
    courierWithdrawals = connection.model(CourierWithdrawal.name, CourierWithdrawalSchema);
    orders = connection.model(Order.name, OrderSchema);
    invoices = connection.model(Invoice.name, InvoiceSchema);
    refunds = connection.model(Refund.name, RefundSchema);

    service = new FinanceService(
      transactions as any,
      merchantWithdrawals as any,
      courierWithdrawals as any,
      orders as any,
      invoices as any,
      refunds as any,
    );
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await connection.close();
  });

  afterEach(async () => {
    await Promise.all(
      [transactions, merchantWithdrawals, courierWithdrawals, orders, invoices, refunds].map((model) =>
        model.collection.deleteMany({}),
      ),
    );
  });

  function oid(): Types.ObjectId {
    return new Types.ObjectId();
  }

  /** `insertOne` brut ne caste rien : sans cette conversion, un montant reste
   * une chaîne JS et `$sum` l'ignore silencieusement (une chaîne n'est pas
   * sommable), ce qui aurait fait passer des agrégations cassées pour des
   * agrégations justes en renvoyant simplement 0 partout. */
  function decimal(value: string): mongoose.Types.Decimal128 {
    return mongoose.Types.Decimal128.fromString(value);
  }

  async function seedOrder(overrides: Record<string, unknown> = {}): Promise<any> {
    const _id = oid();
    const amountsOverride = (overrides.amounts as Record<string, string> | undefined) ?? {
      subtotal: '2000',
      shippingFee: '500',
      discount: '0',
      tip: '0',
      total: '2500',
    };
    const doc = {
      _id,
      orderNumber: `ALG-TEST-${_id.toString().slice(-6)}`,
      userId: oid(),
      customer: { name: 'Client Test', phone: '+261340000000' },
      shopId: oid(),
      shop: { name: 'Boutique Test', slug: 'boutique-test' },
      items: [{ productId: oid(), name: 'Produit', unitPrice: decimal('1000'), quantity: 2, subtotal: decimal('2000') }],
      delivery: { method: 'delivery', workflowStatus: 'received' },
      payment: { method: 'cod', status: 'unpaid' },
      status: 'pending',
      timeline: [],
      ...overrides,
      amounts: {
        subtotal: decimal(amountsOverride.subtotal),
        shippingFee: decimal(amountsOverride.shippingFee),
        discount: decimal(amountsOverride.discount),
        tip: decimal(amountsOverride.tip),
        total: decimal(amountsOverride.total),
      },
    };
    await orders.collection.insertOne(doc);
    return doc;
  }

  describe('recordDeliveryRevenue', () => {
    it('dépose une ligne de commission (10% du sous-total) et une ligne de frais de livraison', async () => {
      const order = await seedOrder();
      await service.recordDeliveryRevenue(order);

      const rows = await transactions.find({ orderId: order._id }).lean();
      expect(rows).toHaveLength(2);

      const commission: any = rows.find((r: any) => r.type === 'commission');
      const deliveryFee: any = rows.find((r: any) => r.type === 'delivery_fee');
      expect(Number(commission.amount)).toBeCloseTo(200); // 10% de 2000
      expect(Number(deliveryFee.amount)).toBeCloseTo(500);
      expect(commission.shopId.toString()).toBe(String(order.shopId));
    });

    it('est idempotent — rejouer sur la même commande ne dépose rien de plus', async () => {
      const order = await seedOrder();
      await service.recordDeliveryRevenue(order);
      await service.recordDeliveryRevenue(order);
      await expect(transactions.countDocuments({ orderId: order._id })).resolves.toBe(2);
    });

    it("n'insère aucune ligne de commission quand le sous-total est nul", async () => {
      const order = await seedOrder({ amounts: { subtotal: '0', shippingFee: '500', discount: '0', tip: '0', total: '500' } });
      await service.recordDeliveryRevenue(order);
      const rows = await transactions.find({ orderId: order._id }).lean();
      expect(rows.map((r: any) => r.type)).toEqual(['delivery_fee']);
    });
  });

  describe('createRefund', () => {
    it('dépose un remboursement qualifié, une ligne de grand livre, et bascule la commande', async () => {
      const order = await seedOrder({ payment: { method: 'mvola', status: 'paid' }, status: 'shipped' });
      const adminId = oid().toString();

      const refund = await service.createRefund(String(order._id), undefined, 'Produit non conforme', adminId);

      expect((refund as any).amount).toBeDefined();
      expect(Number((refund as any).amount)).toBeCloseTo(2500); // total par défaut

      const [transaction] = await transactions.find({ orderId: order._id, type: 'refund' }).lean();
      expect(Number(transaction.amount)).toBeCloseTo(2500);

      const updated: any = await orders.findById(order._id).lean();
      expect(updated.payment.status).toBe('refunded');
      expect(updated.status).toBe('cancelled');
    });

    it('accepte un remboursement partiel avec un montant explicite', async () => {
      const order = await seedOrder({ payment: { method: 'mvola', status: 'paid' } });
      const refund = await service.createRefund(String(order._id), 1000, 'Article manquant', oid().toString());
      expect(Number((refund as any).amount)).toBeCloseTo(1000);
    });

    it('refuse un montant de remboursement invalide', async () => {
      const order = await seedOrder();
      await expect(service.createRefund(String(order._id), -5, 'x', oid().toString())).rejects.toThrow(AppError);
    });

    it('une commande introuvable est un 404 explicite', async () => {
      await expect(service.createRefund(oid().toString(), undefined, 'x', oid().toString())).rejects.toThrow(AppError);
    });
  });

  describe('generateInvoice', () => {
    it('génère une facture numérotée à partir de la commande et pose `order.invoiceId`', async () => {
      const order = await seedOrder({ payment: { method: 'cod', status: 'paid' } });
      const invoice = await service.generateInvoice(String(order._id), oid().toString());

      expect((invoice as any).invoiceNumber).toMatch(/^FAC-\d{4}-\d{4}$/);
      expect((invoice as any).status).toBe('paid');

      const updated: any = await orders.findById(order._id).lean();
      expect(updated.invoiceId).toBeDefined();
    });

    it('refuse une seconde facture pour la même commande', async () => {
      const order = await seedOrder();
      await service.generateInvoice(String(order._id), oid().toString());
      await expect(service.generateInvoice(String(order._id), oid().toString())).rejects.toThrow('déjà une facture');
    });

    it('numérote deux factures consécutivement dans la même année', async () => {
      const orderA = await seedOrder();
      const orderB = await seedOrder();
      const invoiceA = await service.generateInvoice(String(orderA._id), oid().toString());
      const invoiceB = await service.generateInvoice(String(orderB._id), oid().toString());
      expect((invoiceA as any).invoiceNumber).not.toBe((invoiceB as any).invoiceNumber);
    });
  });

  describe('retraits commerçants', () => {
    it('le solde retirable est le chiffre d’affaires livré net de commission, moins les retraits en cours', async () => {
      const shopId = oid();
      await seedOrder({ shopId, status: 'delivered', amounts: { subtotal: '10000', shippingFee: '1000', discount: '0', tip: '0', total: '11000' } });

      const before = await service.merchantBalance(shopId.toString());
      expect(before.balance).toBeCloseTo(9000); // 10000 * (1 - 10%)

      await service.requestMerchantWithdrawal(shopId.toString(), oid().toString(), 3000, 'mobile_money', '+261340000001');
      const after = await service.merchantBalance(shopId.toString());
      expect(after.balance).toBeCloseTo(6000);
    });

    it('refuse une demande qui dépasse le solde disponible', async () => {
      const shopId = oid();
      await seedOrder({ shopId, status: 'delivered', amounts: { subtotal: '1000', shippingFee: '0', discount: '0', tip: '0', total: '1000' } });
      await expect(
        service.requestMerchantWithdrawal(shopId.toString(), oid().toString(), 5000, 'mobile_money', '+261340000001'),
      ).rejects.toThrow('Solde insuffisant');
    });

    it('honorer un retrait dépose une ligne de grand livre ; le rejeter n’en dépose aucune', async () => {
      const shopId = oid();
      await seedOrder({ shopId, status: 'delivered', amounts: { subtotal: '10000', shippingFee: '0', discount: '0', tip: '0', total: '10000' } });
      const withdrawal = await service.requestMerchantWithdrawal(shopId.toString(), oid().toString(), 1000, 'mobile_money', '+261340000001');

      await service.resolveMerchantWithdrawal(String((withdrawal as any)._id), 'paid');
      await expect(transactions.countDocuments({ type: 'merchant_withdrawal' })).resolves.toBe(1);

      const withdrawal2 = await service.requestMerchantWithdrawal(shopId.toString(), oid().toString(), 1000, 'mobile_money', '+261340000001');
      await service.resolveMerchantWithdrawal(String((withdrawal2 as any)._id), 'rejected');
      await expect(transactions.countDocuments({ type: 'merchant_withdrawal' })).resolves.toBe(1);
    });
  });

  describe('retraits livreurs (approbation admin)', () => {
    it('honorer un retrait livreur dépose une ligne de grand livre', async () => {
      const courierId = oid();
      const withdrawal = await courierWithdrawals.create({ courierId, amount: 5000, method: 'mobile_money', account: '+261340000002' });

      await service.resolveCourierWithdrawal(String(withdrawal._id), 'paid');

      const [transaction] = await transactions.find({ type: 'courier_withdrawal' }).lean();
      expect(transaction).toBeDefined();
      expect(Number(transaction.amount)).toBeCloseTo(5000);
      expect(transaction.userId.toString()).toBe(courierId.toString());
    });

    it('un retrait introuvable est un 404 explicite', async () => {
      await expect(service.resolveCourierWithdrawal(oid().toString(), 'paid')).rejects.toThrow(AppError);
    });
  });

  describe('résumés et rapports', () => {
    it('commissionsSummary agrège le total et le nombre de commissions complétées', async () => {
      const order = await seedOrder({ amounts: { subtotal: '5000', shippingFee: '0', discount: '0', tip: '0', total: '5000' } });
      await service.recordDeliveryRevenue(order);

      const summary = await service.commissionsSummary();
      expect(summary.lifetime.count).toBe(1);
      expect(Number(summary.lifetime.total)).toBeCloseTo(500); // 10% de 5000
    });

    it('revenueSummary combine commissions, frais de livraison et remboursements sur la période', async () => {
      const order = await seedOrder({ status: 'delivered', amounts: { subtotal: '10000', shippingFee: '1000', discount: '0', tip: '0', total: '11000' }, payment: { method: 'cod', status: 'paid' } });
      await service.recordDeliveryRevenue(order);
      await service.createRefund(String(order._id), 500, 'Retour partiel', oid().toString());

      const summary = await service.revenueSummary();
      expect(summary.commissionRevenue).toBeCloseTo(1000); // 10% de 10000
      expect(summary.deliveryFeeRevenue).toBeCloseTo(1000);
      expect(summary.refunded).toBeCloseTo(500);
      expect(summary.netPlatformRevenue).toBeCloseTo(1500); // 1000 + 1000 - 500
    });

    it('financialReport regroupe les mouvements complétés par type sur la période', async () => {
      const order = await seedOrder({ amounts: { subtotal: '2000', shippingFee: '200', discount: '0', tip: '0', total: '2200' } });
      await service.recordDeliveryRevenue(order);

      const report = await service.financialReport();
      expect(report.byType.commission.count).toBe(1);
      expect(report.byType.delivery_fee.count).toBe(1);
    });
  });
});
