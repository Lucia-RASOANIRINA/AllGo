import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import { encodeCursor, decodeCursor, prismaCursorFilter } from '../../common/pagination/cursor';
import type { Paginated } from '../../common/http/response.interceptor';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import { PaymentsService } from '../payments/payments.service';
import { EventsGateway, RealtimeEvent } from '../realtime/events.gateway';
import { ORDER_TRANSITIONS, ORDER_STATUSES, type OrderStatus } from './schemas/order.schema';
import type { CreateOrderDto } from './dto/create-order.dto';
import { evaluateCoupon } from './utils/evaluate-coupon';
import { markCouponRedeemed, resolveCouponByCode } from './utils/resolve-coupon';

type CartRow = Prisma.cartGetPayload<{ include: { products: true } }>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly payments: PaymentsService,
    private readonly realtime: EventsGateway,
  ) {}

  /**
   * Création de commande — **transactionnelle** (§6.3), désormais une vraie
   * transaction InnoDB plutôt qu'une session Mongo à replica set.
   *
   * Une commande par boutique représentée dans le panier ; `order_items`,
   * décrément de stock et première ligne d'historique évoluent ensemble, ou
   * rien n'est créé.
   */
  async create(
    userId: number,
    dto: CreateOrderDto,
    customerPhone: string,
  ): Promise<{ orders: unknown[] }> {
    const cartRows = await this.prisma.cart.findMany({
      where: { user_id: userId },
      include: { products: true },
    });
    if (cartRows.length === 0) {
      throw new AppError('CART_EMPTY', 'Votre panier est vide.', 400);
    }

    // Ne jamais créer une commande `unpaid` que le client ne pourra de toute
    // façon jamais payer — vérifié avant toute écriture (§ décision du
    // 2026-09-09, mise en marché). `cod` n'a pas de fournisseur, toujours autorisé.
    if (dto.paymentMethod !== 'cod' && !this.payments.provider(dto.paymentMethod)?.isAvailable()) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        'Ce moyen de paiement est momentanément indisponible. Choisissez un autre mode de paiement.',
        503,
        { provider: dto.paymentMethod },
      );
    }

    let resolvedCoupon: Awaited<ReturnType<typeof resolveCouponByCode>> = null;
    if (dto.couponCode) {
      resolvedCoupon = await resolveCouponByCode(this.prisma, dto.couponCode);
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

    // Un retrait en boutique n'a pas de livreur à remercier ; le pourboire ne
    // s'applique qu'à une livraison. Un panier multi-boutiques applique le
    // même montant à chaque commande générée.
    const tip = dto.delivery.method === 'pickup' ? 0 : (dto.tip ?? 0);
    const shippingFee = dto.delivery.method === 'pickup' ? 0 : (dto.shippingFee ?? 0);

    const byShop = OrdersService.groupByShop(cartRows);
    let couponApplied = false;
    const createdIds: number[] = [];

    for (const [shopId, items] of byShop) {
      // `timeout` par défaut de Prisma (5 s) trop court pour une transaction à
      // plusieurs allers-retours dès une latence réseau non négligeable vers
      // la base (§ constaté en exécution).
      const created = await this.prisma.$transaction(async (tx) => {
        const { lines, subtotal } = await this.consumeStock(tx, items);

        let discount = 0;
        let couponId: number | undefined;
        if (resolvedCoupon) {
          const evaluation = evaluateCoupon(resolvedCoupon, String(shopId), subtotal);
          if (evaluation.valid) {
            discount = evaluation.discount;
            couponId = resolvedCoupon.source === 'coupon' ? Number(resolvedCoupon.refId) : undefined;
            couponApplied = true;
          }
        }

        const total = Math.max(0, subtotal + shippingFee + tip - discount);

        const order = await tx.orders.create({
          data: {
            user_id: userId,
            shop_id: shopId,
            order_number: `PENDING-${Date.now()}-${shopId}`,
            total_amount: total,
            status: 'pending',
            payment_method: dto.paymentMethod as never,
            payment_status: 'unpaid',
            delivery_method: dto.delivery.method,
            delivery_address: dto.delivery.address,
            delivery_city: dto.delivery.city,
            delivery_phone: dto.delivery.phone ?? customerPhone,
            note: dto.delivery.note,
            shipping_fee: shippingFee,
            tip_amount: tip,
            coupon_id: couponId,
            discount_amount: discount,
            delivery_workflow_status: dto.delivery.method === 'delivery' ? 'received' : undefined,
            order_items: { create: lines },
          },
        });

        const orderNumber = `ALG-${new Date().getUTCFullYear()}-${String(order.id).padStart(4, '0')}`;
        await tx.orders.update({ where: { id: order.id }, data: { order_number: orderNumber } });
        await tx.order_status_history.create({ data: { order_id: order.id, status: 'pending' } });

        return order.id;
      }, { timeout: 15_000 });
      createdIds.push(created);
    }

    await this.prisma.cart.deleteMany({ where: { user_id: userId } });
    if (resolvedCoupon && couponApplied) {
      await markCouponRedeemed(this.prisma, resolvedCoupon);
    }

    const orders = await this.prisma.orders.findMany({
      where: { id: { in: createdIds } },
      include: { order_items: true },
    });

    // Les effets externes (Socket.IO) sont émis APRÈS validation de chaque
    // transaction : notifier une commande qui vient d'être annulée serait pire
    // que ne pas notifier du tout.
    for (const order of orders) {
      this.realtime.emitToShop(String(order.shop_id), RealtimeEvent.OrderNew, {
        orderId: String(order.id),
        orderNumber: order.order_number,
        at: new Date().toISOString(),
      });
    }

    return { orders: orders.map((o) => this.toJson(o)) };
  }

  private static groupByShop(rows: CartRow[]): Map<number, CartRow[]> {
    const byShop = new Map<number, CartRow[]>();
    for (const row of rows) {
      const key = row.products.shop_id;
      byShop.set(key, [...(byShop.get(key) ?? []), row]);
    }
    return byShop;
  }

  /**
   * Décrémente le stock de chaque article et construit les lignes de
   * commande, à l'intérieur de la transaction appelante.
   */
  private async consumeStock(
    tx: Prisma.TransactionClient,
    items: CartRow[],
  ): Promise<{ lines: Prisma.order_itemsCreateWithoutOrdersInput[]; subtotal: number }> {
    const lines: Prisma.order_itemsCreateWithoutOrdersInput[] = [];
    let subtotal = 0;

    for (const item of items) {
      const product = await tx.products.findUnique({ where: { id: item.product_id } });
      if (!product || product.status !== 'published') {
        throw new AppError(
          'PRODUCT_UNAVAILABLE',
          `« ${item.products.name} » n'est plus disponible.`,
          409,
          { productId: item.product_id },
        );
      }

      /**
       * Décrément **conditionnel** et atomique (§6.4) : `count === 0` signifie
       * stock insuffisant, la transaction entière est annulée. Le web exécute
       * `UPDATE products SET stock = stock - :qty` sans condition — le stock y
       * devient négatif quand deux clients commandent simultanément le
       * dernier article.
       */
      const decrement = await tx.products.updateMany({
        where: { id: product.id, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (decrement.count === 0) {
        throw AppError.insufficientStock(product.name, product.stock ?? 0, item.quantity);
      }

      const unitPrice = Number(product.promo_price ?? product.price);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;

      lines.push({
        products: { connect: { id: product.id } },
        product_variants: item.variant_id ? { connect: { id: item.variant_id } } : undefined,
        quantity: item.quantity,
        unit_price: unitPrice,
      });
    }

    return { lines, subtotal };
  }

  /** Commandes de l'utilisateur, paginées par curseur. */
  async listForUser(userId: number, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const where: Prisma.ordersWhereInput = { user_id: userId };
    if (cursor) Object.assign(where, prismaCursorFilter('created_at', decodeCursor(cursor)));

    const rows = await this.prisma.orders.findMany({
      where,
      include: { order_items: true },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return this.paginate(rows, limit);
  }

  async findForUser(userId: number, orderId: string): Promise<unknown> {
    const order = await this.prisma.orders.findFirst({
      where: { id: Number(orderId), user_id: userId },
      include: { order_items: true },
    });
    if (!order) throw AppError.notFound('Commande');
    return this.toJson(order);
  }

  /** Commandes d'une boutique, filtrables par statut. */
  async listForShop(
    shopId: string,
    limit: number,
    status?: OrderStatus,
    cursor?: string,
    q?: string,
  ): Promise<Paginated<unknown>> {
    const where: Prisma.ordersWhereInput = { shop_id: Number(shopId) };
    if (status) where.status = status;
    if (q) where.OR = [{ order_number: { contains: q } }, { delivery_phone: { contains: q } }];
    if (cursor) Object.assign(where, prismaCursorFilter('created_at', decodeCursor(cursor)));

    const rows = await this.prisma.orders.findMany({
      where,
      include: { order_items: true },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return this.paginate(rows, limit);
  }

  /**
   * Changement de statut, contraint par la machine à états `ORDER_TRANSITIONS`
   * (structure de données pure, portée telle quelle). Une commande livrée ne
   * peut plus changer d'état ; une commande annulée non plus.
   */
  async updateStatus(
    orderId: string,
    shopId: string,
    next: OrderStatus,
    byUserId: number,
    note?: string,
  ): Promise<unknown> {
    const order = await this.prisma.orders.findFirst({ where: { id: Number(orderId), shop_id: Number(shopId) } });
    if (!order) throw AppError.notFound('Commande');

    const current = (order.status ?? 'pending') as OrderStatus;
    if (!ORDER_TRANSITIONS[current].includes(next)) {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        `Une commande « ${current} » ne peut pas passer à « ${next} ».`,
        409,
        { from: current, to: next, allowed: ORDER_TRANSITIONS[current] },
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.orders.update({ where: { id: order.id }, data: { status: next } }),
      this.prisma.order_status_history.create({ data: { order_id: order.id, status: next, note, changed_by: byUserId } }),
    ]);

    if (next === 'delivered') await this.finance.recordDeliveryRevenue(order.id);

    // Sans cet événement, le client doit tirer manuellement l'écran de
    // commande pour voir un changement de statut décidé par la boutique ou
    // le livreur — un délai qui n'a aucune raison d'exister (§7.5).
    const payload = { orderId: String(order.id), status: next, at: new Date().toISOString() };
    this.realtime.emitToUser(String(order.user_id), RealtimeEvent.OrderStatus, payload);
    this.realtime.emitToShop(String(order.shop_id), RealtimeEvent.OrderStatus, payload);
    if (order.courier_id) this.realtime.emitToUser(String(order.courier_id), RealtimeEvent.OrderStatus, payload);

    return this.toJson(updated);
  }

  async cancelForUser(orderId: string, userId: number): Promise<unknown> {
    const order = await this.prisma.orders.findFirst({ where: { id: Number(orderId), user_id: userId } });
    if (!order) throw AppError.notFound('Commande');
    if (order.payment_status === 'paid') {
      throw new AppError(
        'REFUND_REQUIRED',
        'Cette commande est déjà payée et doit être remboursée par la boutique.',
        409,
      );
    }

    const current = (order.status ?? 'pending') as OrderStatus;
    if (!ORDER_TRANSITIONS[current].includes('cancelled')) {
      throw new AppError('INVALID_STATUS_TRANSITION', 'Cette commande ne peut plus être annulée.', 409);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.orders.update({ where: { id: order.id }, data: { status: 'cancelled' } }),
      this.prisma.order_status_history.create({
        data: { order_id: order.id, status: 'cancelled', note: 'Annulée par le client.', changed_by: userId },
      }),
    ]);

    // La boutique voit l'annulation en direct plutôt que de la découvrir en
    // rafraîchissant sa liste de commandes (§7.5).
    this.realtime.emitToShop(String(order.shop_id), RealtimeEvent.OrderStatus, {
      orderId: String(order.id),
      status: 'cancelled',
      at: new Date().toISOString(),
    });

    return this.toJson(updated);
  }

  /**
   * Ouverture d'un litige — le client seul peut en ouvrir un sur SA commande ;
   * le traitement (résolution/rejet) est réservé à la modération plateforme.
   */
  async raiseDispute(orderId: string, userId: number, reason: string): Promise<unknown> {
    const order = await this.prisma.orders.findFirst({ where: { id: Number(orderId), user_id: userId } });
    if (!order) throw AppError.notFound('Commande');
    const dispute = await this.prisma.order_disputes.create({
      data: { order_id: order.id, raised_by: userId, reason },
    });
    return { id: String(dispute.id), orderId: String(dispute.order_id), status: dispute.status, createdAt: dispute.created_at };
  }

  async cancelForShop(orderId: string, shopId: string, userId: number): Promise<unknown> {
    const order = await this.prisma.orders.findFirst({ where: { id: Number(orderId), shop_id: Number(shopId) } });
    if (!order) throw AppError.notFound('Commande');
    const current = (order.status ?? 'pending') as OrderStatus;
    if (!ORDER_TRANSITIONS[current].includes('cancelled')) {
      throw new AppError('INVALID_STATUS_TRANSITION', 'Cette commande ne peut plus être refusée.', 409);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.orders.update({ where: { id: order.id }, data: { status: 'cancelled' } }),
      this.prisma.order_status_history.create({
        data: { order_id: order.id, status: 'cancelled', note: 'Refusée par la boutique.', changed_by: userId },
      }),
    ]);
    return this.toJson(updated);
  }

  /**
   * Confirme l'encaissement d'un paiement à la livraison — réservé aux
   * commandes contre-remboursement ; un paiement mobile money suit le webhook
   * du fournisseur (voir `PaymentsService`), jamais cette route.
   */
  async collectPayment(orderId: string, shopId: string): Promise<unknown> {
    const order = await this.prisma.orders.findFirst({ where: { id: Number(orderId), shop_id: Number(shopId) } });
    if (!order) throw AppError.notFound('Commande');
    if (order.payment_method !== 'cod') {
      throw new AppError('NOT_COD', 'Seule une commande contre-remboursement peut être encaissée manuellement.', 409);
    }
    if (order.payment_status === 'paid') {
      throw new AppError('ALREADY_PAID', 'Cette commande est déjà marquée payée.', 409);
    }
    const updated = await this.prisma.orders.update({ where: { id: order.id }, data: { payment_status: 'paid' } });
    return this.toJson(updated);
  }

  // --- Flux livreur -------------------------------------------------------

  async courierMissions(userId: number): Promise<unknown[]> {
    const rows = await this.prisma.orders.findMany({
      where: {
        OR: [
          { courier_id: userId },
          { courier_id: null, status: { in: ['confirmed', 'preparing'] } },
        ],
      },
      orderBy: { created_at: 'desc' },
      take: 50,
      include: { order_items: true },
    });
    return rows.map((r) => this.toJson(r));
  }

  async acceptMission(orderId: string, userId: number): Promise<unknown> {
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    const result = await this.prisma.orders.updateMany({
      where: { id: Number(orderId), courier_id: null, status: { in: ['confirmed', 'preparing'] } },
      data: { courier_id: userId, delivery_workflow_status: 'accepted', delivery_accepted_at: new Date(), delivery_otp_code: otp },
    });
    if (!result.count) throw AppError.notFound('Mission');
    const order = await this.prisma.orders.findUnique({ where: { id: Number(orderId) }, include: { order_items: true } });
    return this.toJson(order!);
  }

  async refuseMission(orderId: string, userId: number): Promise<{ refused: true }> {
    const result = await this.prisma.orders.updateMany({
      where: { id: Number(orderId), courier_id: userId },
      data: { courier_id: null, delivery_workflow_status: 'received' },
    });
    if (!result.count) throw AppError.notFound('Mission');
    return { refused: true };
  }

  async updateCourierWorkflow(orderId: string, userId: number, status: string): Promise<unknown> {
    const allowed = ['to_shop', 'picked_up', 'to_client', 'client_found'];
    if (!allowed.includes(status)) throw new AppError('INVALID_WORKFLOW', 'Étape de livraison invalide.', 400);
    const result = await this.prisma.orders.updateMany({
      where: { id: Number(orderId), courier_id: userId },
      data: { delivery_workflow_status: status },
    });
    if (!result.count) throw AppError.notFound('Mission');
    const order = await this.prisma.orders.findUnique({ where: { id: Number(orderId) }, include: { order_items: true } });
    return this.toJson(order!);
  }

  async completeDelivery(orderId: string, userId: number, otp: string, photoUrl?: string): Promise<unknown> {
    const order = await this.prisma.orders.findFirst({ where: { id: Number(orderId), courier_id: userId } });
    if (!order) throw AppError.notFound('Mission');
    if (order.delivery_otp_code && order.delivery_otp_code !== otp) {
      throw new AppError('OTP_INVALID', 'Code OTP invalide.', 400);
    }

    const updated = await this.prisma.orders.update({
      where: { id: order.id },
      data: {
        status: 'delivered',
        delivery_workflow_status: 'delivered',
        delivery_proof_photo: photoUrl,
        delivery_proof_captured_at: photoUrl ? new Date() : undefined,
      },
      include: { order_items: true },
    });
    await this.prisma.order_status_history.create({
      data: { order_id: order.id, status: 'delivered', changed_by: userId },
    });
    await this.finance.recordDeliveryRevenue(order.id);
    return this.toJson(updated);
  }

  private paginate(
    rows: Array<{ id: number; created_at: Date | null }>,
    limit: number,
  ): Paginated<unknown> {
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];

    return {
      items: items.map((r) => this.toJson(r as Parameters<typeof this.toJson>[0])),
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ value: last.created_at!.toISOString(), id: String(last.id) }) : null,
    };
  }

  private toJson(order: {
    id: number;
    user_id: number;
    shop_id: number;
    order_number: string;
    total_amount: unknown;
    status: string | null;
    payment_method: string | null;
    payment_status: string | null;
    delivery_method: string | null;
    delivery_address: string | null;
    delivery_city: string | null;
    delivery_phone: string | null;
    shipping_fee: unknown;
    tip_amount: unknown;
    discount_amount: unknown;
    note: string | null;
    courier_id: number | null;
    delivery_workflow_status: string | null;
    delivery_otp_code: string | null;
    delivery_proof_photo: string | null;
    created_at: Date | null;
    updated_at: Date | null;
    order_items?: Array<{
      id: number;
      product_id: number;
      variant_id: number | null;
      quantity: number;
      unit_price: unknown;
    }>;
  }): unknown {
    return {
      id: String(order.id),
      orderNumber: order.order_number,
      userId: String(order.user_id),
      shopId: String(order.shop_id),
      items: (order.order_items ?? []).map((item) => ({
        id: String(item.id),
        productId: String(item.product_id),
        variantId: item.variant_id ? String(item.variant_id) : undefined,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        subtotal: Number(item.unit_price) * item.quantity,
      })),
      amounts: {
        shippingFee: order.shipping_fee ?? 0,
        discount: order.discount_amount ?? 0,
        tip: order.tip_amount ?? 0,
        total: order.total_amount,
      },
      delivery: {
        method: order.delivery_method,
        address: order.delivery_address ?? undefined,
        city: order.delivery_city ?? undefined,
        phone: order.delivery_phone ?? undefined,
        note: order.note ?? undefined,
        courierId: order.courier_id ? String(order.courier_id) : undefined,
        workflowStatus: order.delivery_workflow_status ?? undefined,
        otpCode: order.delivery_otp_code ?? undefined,
        proof: order.delivery_proof_photo ? { photoUrl: order.delivery_proof_photo } : undefined,
      },
      payment: { method: order.payment_method, status: order.payment_status },
      status: order.status,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
    };
  }
}
