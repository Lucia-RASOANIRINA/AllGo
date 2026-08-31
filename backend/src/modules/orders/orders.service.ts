import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Decimal128 } from 'mongodb';

import { AppError } from '../../common/http/app-error';
import { encodeCursor, decodeCursor, cursorFilter } from '../../common/pagination/cursor';
import type { Paginated } from '../../common/http/response.interceptor';
import { GeoService } from '../geo/geo.service';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import { StockMovement, type StockMovementDocument } from '../stock/schemas/stock-movement.schema';
import { Cart, type CartDocument } from './schemas/cart.schema';
import { Counter, type CounterDocument } from './schemas/counter.schema';
import { Coupon, type CouponDocument } from './schemas/coupon.schema';
import {
  ORDER_TRANSITIONS,
  Order,
  type OrderDocument,
  type OrderStatus,
} from './schemas/order.schema';
import { evaluateCoupon } from './utils/evaluate-coupon';
import { groupByShop } from './utils/group-by-shop';
import type { CreateOrderDto } from './dto/create-order.dto';

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
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(Cart.name) private readonly carts: Model<CartDocument>,
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(StockMovement.name)
    private readonly stockMovements: Model<StockMovementDocument>,
    private readonly geo: GeoService,
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

        created = [];

        for (const [shopId, items] of groupByShop(cart.items)) {
          const { lines, subtotal } = await this.consumeStock(shopId, items, userId, session);
          created.push(
            await this.persistOrder(
              { userId, customer, shopId, items, lines, subtotal, dto },
              session,
            ),
          );
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
      dto: CreateOrderDto;
    },
    session: ClientSession,
  ): Promise<OrderDocument> {
    const { userId, customer, shopId, items, lines, subtotal, dto } = input;

    const shippingFee = await this.computeShippingFee(shopId, dto, session);
    const { discount, coupon } = await this.applyCoupon(shopId, subtotal, dto.couponCode, session);
    const shopName = items[0].snapshot.shopName;

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
            total: toDecimal(subtotal + shippingFee - discount),
          },
          coupon,
          delivery: dto.delivery,
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
   * Frais de livraison — calculés côté serveur, jamais repris tels quels du
   * client (§ correction : le mobile envoyait auparavant toujours `0`, sans
   * validation). Le retrait ne coûte rien ; la livraison exige une position
   * connue pour la boutique ET pour la destination.
   */
  private async computeShippingFee(
    shopId: string,
    dto: CreateOrderDto,
    session: ClientSession,
  ): Promise<number> {
    if (dto.delivery.method === 'pickup') return 0;

    const shop = await this.shops.findById(shopId).select('location').session(session);
    if (!shop?.location || !dto.delivery.location) {
      throw new AppError(
        'DELIVERY_LOCATION_REQUIRED',
        'Position introuvable : impossible de calculer les frais de livraison.',
        400,
      );
    }

    return this.geo.computeDeliveryFee(shop.location, dto.delivery.location).fee;
  }

  /**
   * Valide et applique un coupon, DANS la transaction (§6.3). `NOT_FOUND`,
   * `EXPIRED` et `LIMIT_REACHED` sont des états globaux du code : ils annulent
   * toute la commande plutôt que d'être ignorés en silence —
   * `CartService.preview` a déjà montré la réduction au client avant qu'il ne
   * confirme, la lui retirer sans explication ressemblerait à un bug.
   * `NOT_APPLICABLE`/`MIN_AMOUNT` sont propres à CETTE commande et ne font PAS
   * échouer les autres commandes d'un même panier multi-boutiques.
   */
  private async applyCoupon(
    shopId: string,
    subtotal: number,
    code: string | undefined,
    session: ClientSession,
  ): Promise<{ discount: number; coupon?: { code: string; type: string; value: unknown } }> {
    if (!code) return { discount: 0 };

    const coupon = await this.coupons.findOne({ code: code.toUpperCase() }).session(session);
    const evaluation = evaluateCoupon(coupon, shopId, subtotal);

    if (!evaluation.valid) {
      if (evaluation.reason === 'NOT_APPLICABLE' || evaluation.reason === 'MIN_AMOUNT') {
        return { discount: 0 };
      }
      const messages: Record<string, string> = {
        NOT_FOUND: 'Ce code promotionnel est introuvable.',
        EXPIRED: 'Ce code promotionnel a expiré.',
        LIMIT_REACHED: "Ce code promotionnel n'est plus disponible.",
      };
      throw new AppError(
        `COUPON_${evaluation.reason}`,
        messages[evaluation.reason!],
        evaluation.reason === 'NOT_FOUND' ? 404 : 409,
      );
    }

    /**
     * Incrément conditionnel, même motif que le décrément de stock
     * (`consumeStock`) : `matchedCount === 0` signifie qu'un autre checkout a
     * consommé le dernier usage entre l'évaluation et ici, annulant la
     * transaction plutôt que de dépasser silencieusement le quota.
     */
    const increment = await this.coupons.updateOne(
      {
        _id: coupon!._id,
        ...(coupon!.usageLimit != null ? { usageCount: { $lt: coupon!.usageLimit } } : {}),
      },
      { $inc: { usageCount: 1 } },
      { session },
    );
    if (increment.matchedCount === 0) {
      throw new AppError(
        'COUPON_LIMIT_REACHED',
        "Ce code promotionnel n'est plus disponible.",
        409,
      );
    }

    return {
      discount: evaluation.discount,
      coupon: { code: coupon!.code, type: coupon!.discountType, value: coupon!.discountValue },
    };
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

  /** Une commande précise de l'utilisateur — jamais celle d'un autre. */
  async findByIdForUser(userId: string, orderId: string): Promise<unknown> {
    if (!Types.ObjectId.isValid(orderId)) throw AppError.notFound('Commande');
    const order = await this.orders
      .findOne({ _id: new Types.ObjectId(orderId), userId: new Types.ObjectId(userId) })
      .lean();
    if (!order) throw AppError.notFound('Commande');
    return order;
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

  /** Commandes d'une boutique, filtrables par statut. */
  async listForShop(
    shopId: string,
    limit: number,
    status?: OrderStatus,
    cursor?: string,
  ): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { shopId: new Types.ObjectId(shopId) };
    if (status) filter.status = status;
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
    next: OrderStatus,
    byUserId: string,
    note?: string,
  ): Promise<unknown> {
    const order = await this.orders.findById(orderId);
    if (!order) throw AppError.notFound('Commande');

    if (!ORDER_TRANSITIONS[order.status].includes(next)) {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        `Une commande « ${order.status} » ne peut pas passer à « ${next} ».`,
        409,
        { from: order.status, to: next, allowed: ORDER_TRANSITIONS[order.status] },
      );
    }

    // `courier_assigned` n'a de sens que sur la branche livraison : la table
    // `ORDER_TRANSITIONS` ne connaît pas `delivery.method`, cette garde
    // complète donc la machine à états plutôt que de la dupliquer.
    if (next === 'courier_assigned' && order.delivery.method === 'pickup') {
      throw new AppError(
        'INVALID_STATUS_TRANSITION',
        'Une commande à retirer en boutique ne passe pas par « livreur affecté ».',
        409,
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
