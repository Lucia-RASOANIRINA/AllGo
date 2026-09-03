import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Decimal128 } from 'mongodb';

import { AppError } from '../../common/http/app-error';
import { encodeCursor, decodeCursor, cursorFilter } from '../../common/pagination/cursor';
import type { Paginated } from '../../common/http/response.interceptor';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { StockMovement, type StockMovementDocument } from '../stock/schemas/stock-movement.schema';
import { Cart, type CartDocument } from './schemas/cart.schema';
import { Counter, type CounterDocument } from './schemas/counter.schema';
import { Coupon, type CouponDocument } from './schemas/coupon.schema';
import { Dispute, type DisputeDocument } from './schemas/dispute.schema';
import { Promotion, type PromotionDocument } from '../campaigns/schemas/promotion.schema';
import { FinanceService } from '../finance/finance.service';
import {
  ORDER_TRANSITIONS,
  Order,
  type OrderDocument,
  type OrderStatus,
} from './schemas/order.schema';
import type { CreateOrderDto } from './dto/create-order.dto';
import { evaluateCoupon } from './utils/evaluate-coupon';
import { markCouponRedeemed, resolveCouponByCode, type ResolvedCoupon } from './utils/resolve-coupon';

/** Somme de montants `Decimal128` sans jamais passer par un flottant. */
function toDecimal(value: number | string): Decimal128 {
  return Decimal128.fromString(String(value));
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Cart.name) private readonly carts: Model<CartDocument>,
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
    @InjectModel(StockMovement.name)
    private readonly stockMovements: Model<StockMovementDocument>,
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(Promotion.name) private readonly promotions: Model<PromotionDocument>,
    @InjectModel(Dispute.name) private readonly disputes: Model<DisputeDocument>,
    private readonly finance: FinanceService,
  ) {}

  /**
   * Création de commande — **transactionnelle** (§6.3).
   *
   * Corrige directement le constat §8.2 du document système : la création de
   * commande du web n'est encapsulée dans aucune transaction. Une erreur après
   * l'insertion de la commande y laisse une commande sans lignes, avec un stock
   * déjà décrémenté.
   *
   * Quatre collections évoluent ensemble, ou aucune :
   *   `orders` (une par boutique) · `products.stock` · `stockMovements` · `carts`
   *
   * Le replica set est indispensable : les transactions multi-documents
   * n'existent pas sur une instance MongoDB isolée.
   */
  async create(
    userId: string,
    dto: CreateOrderDto,
    customer: { name: string; phone: string },
  ): Promise<{ orders: unknown[] }> {
    const session = await this.connection.startSession();

    try {
      let created: OrderDocument[] = [];

      await session.withTransaction(async () => {
        const cart = await this.carts.findById(userId).session(session);
        if (!cart || cart.items.length === 0) {
          throw new AppError('CART_EMPTY', 'Votre panier est vide.', 400);
        }

        // Un code promo invalide, expiré ou épuisé refuse la commande entière —
        // ces trois raisons ne dépendent d'aucune boutique en particulier
        // (§ commentaire `evaluateCoupon`). `NOT_APPLICABLE` et `MIN_AMOUNT` en
        // revanche ne concernent qu'UNE commande d'un panier qui peut en
        // produire plusieurs : ils sont réévalués boutique par boutique plus bas.
        let resolvedCoupon: ResolvedCoupon | null = null;
        if (dto.couponCode) {
          resolvedCoupon = await resolveCouponByCode(this.coupons, this.promotions, dto.couponCode, session);
          if (!resolvedCoupon || !resolvedCoupon.active) {
            throw new AppError('COUPON_INVALID', 'Ce code promo est introuvable.', 400);
          }
          if (resolvedCoupon.expiresAt && resolvedCoupon.expiresAt < new Date()) {
            throw new AppError('COUPON_EXPIRED', 'Ce code promo a expiré.', 400);
          }
          if (resolvedCoupon.usageLimit != null && resolvedCoupon.usageCount >= resolvedCoupon.usageLimit) {
            throw new AppError('COUPON_LIMIT_REACHED', 'Ce code promo a atteint sa limite d’utilisation.', 400);
          }
        }

        created = [];
        let couponApplied = false;

        // Un retrait en boutique n'a pas de livreur à remercier ; le pourboire
        // ne s'applique qu'à une livraison. Un panier multi-boutiques applique
        // le même montant à chaque commande générée — répartir un pourboire
        // unique entre plusieurs livreurs distincts n'est pas modélisé.
        const tip = dto.delivery.method === 'pickup' ? 0 : (dto.tip ?? 0);

        for (const [shopId, items] of OrdersService.groupByShop(cart.items)) {
          const { lines, subtotal } = await this.consumeStock(shopId, items, userId, session);

          let discount = 0;
          let appliedCoupon: { code: string; type: string; value: unknown } | undefined;
          if (resolvedCoupon) {
            const evaluation = evaluateCoupon(resolvedCoupon, shopId, subtotal);
            if (evaluation.valid) {
              discount = evaluation.discount;
              appliedCoupon = {
                code: dto.couponCode!.trim().toUpperCase(),
                type: resolvedCoupon.discountType,
                value: resolvedCoupon.discountValue,
              };
              couponApplied = true;
            }
          }

          created.push(
            await this.persistOrder(
              { userId, customer, shopId, items, lines, subtotal, discount, tip, appliedCoupon, dto },
              session,
            ),
          );
        }

        // L'utilisation n'est comptée qu'une fois, après coup : une transaction
        // annulée plus loin n'aurait sinon consommé un usage pour rien.
        if (resolvedCoupon && couponApplied) {
          await markCouponRedeemed(this.coupons, this.promotions, resolvedCoupon, session);
        }

        // Le panier n'est vidé qu'une fois toutes les commandes créées.
        await this.carts.updateOne({ _id: userId }, { $set: { items: [] } }, { session });
      });

      // Les effets externes (Socket.IO, FCM) sont émis APRÈS validation de la
      // transaction : notifier une commande qui vient d'être annulée serait pire
      // que ne pas notifier du tout.
      return { orders: created.map((o) => o.toJSON()) };
    } finally {
      await session.endSession();
    }
  }

  /**
   * Un panier peut contenir des articles de plusieurs boutiques : une commande
   * est créée par boutique, chacune ayant son propre suivi et sa propre livraison.
   */
  private static groupByShop<T extends { snapshot: { shopId: unknown } }>(
    items: T[],
  ): Map<string, T[]> {
    const byShop = new Map<string, T[]>();
    for (const item of items) {
      const key = String(item.snapshot.shopId);
      byShop.set(key, [...(byShop.get(key) ?? []), item]);
    }
    return byShop;
  }

  /**
   * Décrémente le stock de chaque article et construit les lignes de commande.
   *
   * Toute défaillance ici (produit retiré, stock insuffisant) annule la
   * transaction entière : aucun stock n'est consommé pour une commande qui
   * n'existera pas.
   */
  private async consumeStock(
    shopId: string,
    items: CartDocument['items'],
    userId: string,
    session: ClientSession,
  ): Promise<{ lines: OrderDocument['items']; subtotal: number }> {
    const lines: OrderDocument['items'] = [];
    let subtotal = 0;

    for (const item of items) {
      // Le prix est relu depuis `products`, jamais pris dans le panier :
      // l'instantané du panier sert l'affichage, pas la facturation.
      const product = await this.products.findById(item.productId).session(session);
      if (!product || product.status !== 'published') {
        throw new AppError(
          'PRODUCT_UNAVAILABLE',
          `« ${item.snapshot.name} » n'est plus disponible.`,
          409,
          { productId: String(item.productId) },
        );
      }

      const stockBefore = product.stock;

      /**
       * Décrément **conditionnel** et atomique (§6.4).
       *
       * `matchedCount === 0` signifie stock insuffisant : la transaction est
       * annulée. Le web exécute `UPDATE products SET stock = stock - :qty` sans
       * condition — le stock y devient négatif quand deux clients commandent
       * simultanément le dernier article.
       */
      const decrement = await this.products.updateOne(
        { _id: product._id, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity, 'stats.sales': item.quantity } },
        { session },
      );

      if (decrement.matchedCount === 0) {
        throw AppError.insufficientStock(product.name, stockBefore, item.quantity);
      }

      const unitPrice = Number(String(product.promoPrice ?? product.price));
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;

      lines.push({
        productId: product._id as Types.ObjectId,
        variantId: item.variantId,
        // Instantané contractuel : figé au moment de l'achat, jamais réécrit.
        name: product.name,
        image: product.media.find((m) => m.isMain)?.thumbUrl ?? product.media[0]?.thumbUrl,
        unitPrice: toDecimal(unitPrice),
        quantity: item.quantity,
        subtotal: toDecimal(lineTotal),
      } as OrderDocument['items'][number]);

      await this.stockMovements.create(
        [
          {
            at: new Date(),
            shopId: new Types.ObjectId(shopId),
            productId: product._id,
            type: 'out',
            reason: 'order',
            quantity: item.quantity,
            stockBefore,
            stockAfter: stockBefore - item.quantity,
            userId: new Types.ObjectId(userId),
          },
        ],
        { session },
      );
    }

    return { lines, subtotal };
  }

  private async persistOrder(
    input: {
      userId: string;
      customer: { name: string; phone: string };
      shopId: string;
      items: CartDocument['items'];
      lines: OrderDocument['items'];
      subtotal: number;
      discount: number;
      tip: number;
      appliedCoupon?: { code: string; type: string; value: unknown };
      dto: CreateOrderDto;
    },
    session: ClientSession,
  ): Promise<OrderDocument> {
    const { userId, customer, shopId, items, lines, subtotal, discount, tip, appliedCoupon, dto } = input;

    const shippingFee = dto.delivery.method === 'pickup' ? 0 : (dto.shippingFee ?? 0);
    const shopName = items[0].snapshot.shopName;
    const total = Math.max(0, subtotal + shippingFee + tip - discount);

    const [order] = await this.orders.create(
      [
        {
          orderNumber: await this.nextOrderNumber(session),
          userId: new Types.ObjectId(userId),
          customer,
          shopId: new Types.ObjectId(shopId),
          shop: { name: shopName, slug: '', logo: undefined },
          items: lines,
          amounts: {
            subtotal: toDecimal(subtotal),
            shippingFee: toDecimal(shippingFee),
            discount: toDecimal(discount),
            tip: toDecimal(tip),
            total: toDecimal(total),
          },
          coupon: appliedCoupon,
          delivery: { ...dto.delivery, tip: tip > 0 ? toDecimal(tip) : undefined },
          payment: { method: dto.paymentMethod, status: 'unpaid' },
          status: 'pending',
          timeline: [{ status: 'pending', at: new Date(), byUserId: userId }],
        },
      ],
      { session },
    );

    return order;
  }

  /**
   * Numéro de commande : séquence atomique `ALG-<année>-<n>`.
   * Remplace `JM-<année>-<uniqid()>`, dont les collisions n'étaient même pas
   * détectées faute de contrainte d'unicité (§6.2).
   */
  private async nextOrderNumber(session: ClientSession): Promise<string> {
    const year = new Date().getUTCFullYear();
    const counter = await this.counters.findOneAndUpdate(
      { _id: `order:${year}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, session },
    );
    return `ALG-${year}-${String(counter.seq).padStart(4, '0')}`;
  }

  /** Commandes de l'utilisateur, paginées par curseur. */
  async listForUser(userId: string, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    // limit + 1 : le document surnuméraire indique s'il reste une page,
    // sans exiger un `countDocuments()` sur toute la collection.
    const docs = await this.orders
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    return this.paginate(docs, limit);
  }

  async findForUser(userId: string, orderId: string): Promise<unknown> {
    const order = await this.orders
      .findOne({ _id: new Types.ObjectId(orderId), userId: new Types.ObjectId(userId) })
      .lean();
    if (!order) throw AppError.notFound('Commande');
    return order;
  }

  /** Commandes d'une boutique, filtrables par statut. */
  async listForShop(
    shopId: string,
    limit: number,
    status?: OrderStatus,
    cursor?: string,
    q?: string,
  ): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { shopId: new Types.ObjectId(shopId) };
    if (status) filter.status = status;
    if (q) filter.$or = [{ orderNumber: { $regex: q, $options: 'i' } }, { 'customer.phone': { $regex: q, $options: 'i' } }];
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const docs = await this.orders
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    return this.paginate(docs, limit);
  }

  /**
   * Changement de statut, contraint par la machine à états `ORDER_TRANSITIONS`.
   * Une commande livrée ne peut plus changer d'état ; une commande annulée non plus.
   */
  async updateStatus(
    orderId: string,
    shopId: string,
    next: OrderStatus,
    byUserId: string,
    note?: string,
  ): Promise<unknown> {
    const order = await this.orders.findOne({
      _id: new Types.ObjectId(orderId),
      shopId: new Types.ObjectId(shopId),
    });
    if (!order) throw AppError.notFound('Commande');

    if (!ORDER_TRANSITIONS[order.status].includes(next)) {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        `Une commande « ${order.status} » ne peut pas passer à « ${next} ».`,
        409,
        { from: order.status, to: next, allowed: ORDER_TRANSITIONS[order.status] },
      );
    }

    order.status = next;
    order.timeline.push({
      status: next,
      at: new Date(),
      byUserId: new Types.ObjectId(byUserId),
      note,
    });
    await order.save();
    if (next === 'delivered') await this.finance.recordDeliveryRevenue(order);

    return order.toJSON();
  }

  async cancelForUser(orderId: string, userId: string): Promise<unknown> {
    const order = await this.orders.findOne({
      _id: orderId,
      userId: new Types.ObjectId(userId),
    });
    if (!order) throw AppError.notFound('Commande');
    if (order.payment.status === 'paid') {
      throw new AppError(
        'REFUND_REQUIRED',
        'Cette commande est déjà payée et doit être remboursée par la boutique.',
        409,
      );
    }

    if (!ORDER_TRANSITIONS[order.status].includes('cancelled')) {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        'Cette commande ne peut plus être annulée.',
        409,
      );
    }
    order.status = 'cancelled';
    order.payment.status = 'cancelled';
    order.timeline.push({
      status: 'cancelled',
      at: new Date(),
      byUserId: new Types.ObjectId(userId),
      note: 'Annulée par le client.',
    });
    await order.save();
    return order.toJSON();
  }

  /**
   * Ouverture d'un litige — le client seul peut en ouvrir un sur SA commande ;
   * le traitement (résolution/rejet) est réservé à la modération plateforme
   * (`AdministrationService`, `Permission.PlatformModerate`).
   */
  async raiseDispute(orderId: string, userId: string, reason: string): Promise<unknown> {
    const order = await this.orders.findOne({
      _id: new Types.ObjectId(orderId),
      userId: new Types.ObjectId(userId),
    });
    if (!order) throw AppError.notFound('Commande');
    const dispute = await this.disputes.create({
      orderId: order._id,
      raisedBy: new Types.ObjectId(userId),
      reason,
    });
    return dispute.toJSON();
  }

  async cancelForShop(orderId: string, shopId: string, userId: string): Promise<unknown> {
    const order = await this.orders.findOne({
      _id: new Types.ObjectId(orderId),
      shopId: new Types.ObjectId(shopId),
    });
    if (!order) throw AppError.notFound('Commande');
    if (!ORDER_TRANSITIONS[order.status].includes('cancelled')) {
      throw new AppError('INVALID_STATUS_TRANSITION', 'Cette commande ne peut plus être refusée.', 409);
    }

    order.status = 'cancelled';
    order.timeline.push({
      status: 'cancelled',
      at: new Date(),
      byUserId: new Types.ObjectId(userId),
      note: 'Refusée par la boutique.',
    });
    await order.save();
    return order.toJSON();
  }

  async courierMissions(userId: string): Promise<unknown[]> {
    return this.orders.find({ $or: [{ 'delivery.courierId': new Types.ObjectId(userId) }, { 'delivery.courierId': { $exists: false }, status: { $in: ['confirmed', 'preparing'] } }] }).sort({ createdAt: -1 }).limit(50).lean();
  }

  async acceptMission(orderId: string, userId: string): Promise<unknown> {
    const order = await this.orders.findOneAndUpdate({ _id: orderId, 'delivery.courierId': { $exists: false }, status: { $in: ['confirmed', 'preparing'] } }, { $set: { 'delivery.courierId': new Types.ObjectId(userId), 'delivery.workflowStatus': 'accepted', 'delivery.acceptedAt': new Date(), 'delivery.otpCode': String(Math.floor(1000 + Math.random() * 9000)) } }, { new: true });
    if (!order) throw AppError.notFound('Mission');
    return order.toJSON();
  }

  async refuseMission(orderId: string, userId: string): Promise<{ refused: true }> {
    const result = await this.orders.updateOne({ _id: orderId, 'delivery.courierId': new Types.ObjectId(userId) }, { $unset: { 'delivery.courierId': 1 }, $set: { 'delivery.workflowStatus': 'received' } });
    if (!result.modifiedCount) throw AppError.notFound('Mission');
    return { refused: true };
  }

  async updateCourierWorkflow(orderId: string, userId: string, status: string): Promise<unknown> {
    const allowed = ['to_shop', 'picked_up', 'to_client', 'client_found'];
    if (!allowed.includes(status)) throw new AppError('INVALID_WORKFLOW', 'Étape de livraison invalide.', 400);
    const order = await this.orders.findOneAndUpdate({ _id: orderId, 'delivery.courierId': new Types.ObjectId(userId) }, { $set: { 'delivery.workflowStatus': status } }, { new: true });
    if (!order) throw AppError.notFound('Mission');
    return order.toJSON();
  }

  async completeDelivery(orderId: string, userId: string, otp: string, photoUrl?: string): Promise<unknown> {
    const order = await this.orders.findOne({ _id: orderId, 'delivery.courierId': new Types.ObjectId(userId) });
    if (!order) throw AppError.notFound('Mission');
    if (order.delivery.otpCode && order.delivery.otpCode !== otp) throw new AppError('OTP_INVALID', 'Code OTP invalide.', 400);
    order.status = 'delivered';
    order.delivery.workflowStatus = 'delivered';
    order.delivery.proof = photoUrl ? { photoUrl, capturedAt: new Date() } : undefined;
    await order.save();
    await this.finance.recordDeliveryRevenue(order);
    return order.toJSON();
  }

  private paginate(
    docs: Array<{ _id: unknown; createdAt: Date }>,
    limit: number,
  ): Paginated<unknown> {
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
}
