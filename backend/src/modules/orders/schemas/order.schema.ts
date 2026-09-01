import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { GeoPoint, GeoPointSchema } from '../../users/schemas/user.schema';

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  /**
   * `preparing` n'existe pas dans le web : impossible d'y distinguer
   * « commande acceptée » de « commande en préparation », ce qui rend le suivi
   * client imprécis (§6.2).
   */
  'preparing',
  'shipped',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Transitions autorisées. Toute autre transition est refusée par le service. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/**
 * Ligne de commande — **instantané contractuel** (§6.1).
 *
 * Le nom, l'image et le prix unitaire sont figés au moment de l'achat. Un
 * changement de tarif ultérieur ne doit JAMAIS réécrire l'historique : une
 * facture émise il y a six mois doit rester exacte.
 */
@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true }) productId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) variantId?: Types.ObjectId;
  @Prop({ required: true }) name!: string;
  @Prop() image?: string;
  @Prop({ type: MongooseSchema.Types.Decimal128, required: true }) unitPrice!: unknown;
  @Prop({ required: true, min: 1 }) quantity!: number;
  @Prop({ type: MongooseSchema.Types.Decimal128, required: true }) subtotal!: unknown;
}
export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

/** Preuve de livraison capturée sur mobile — impossible sur le web (§2.2). */
@Schema({ _id: false })
export class DeliveryProof {
  @Prop({ required: true }) photoUrl!: string;
  @Prop() signatureUrl?: string;
  @Prop({ type: Date, required: true }) capturedAt!: Date;
  @Prop({ type: GeoPointSchema }) location?: GeoPoint;
}
export const DeliveryProofSchema = SchemaFactory.createForClass(DeliveryProof);

@Schema({ _id: false })
export class Delivery {
  @Prop({ type: String, enum: ['delivery', 'pickup'], default: 'delivery' })
  method!: 'delivery' | 'pickup';
  @Prop() address?: string;
  @Prop() city?: string;
  @Prop() phone?: string;
  @Prop() note?: string;
  @Prop({ type: GeoPointSchema }) location?: GeoPoint;
  @Prop({ type: Types.ObjectId, ref: 'User' }) courierId?: Types.ObjectId;
  @Prop({ type: DeliveryProofSchema }) proof?: DeliveryProof;
  @Prop({ type: String, enum: ['received', 'accepted', 'to_shop', 'picked_up', 'to_client', 'client_found', 'delivered'], default: 'received' })
  workflowStatus!: string;
  @Prop() otpCode?: string;
  @Prop({ type: Date }) acceptedAt?: Date;
}
export const DeliverySchema = SchemaFactory.createForClass(Delivery);

@Schema({ _id: false })
export class Payment {
  @Prop({
    type: String,
    enum: ['cod', 'mvola', 'orange_money', 'airtel_money', 'card'],
    required: true,
  })
  method!: string;

  @Prop({
    type: String,
    enum: ['unpaid', 'pending', 'paid', 'failed', 'cancelled', 'refunded'],
    default: 'unpaid',
  })
  status!: 'unpaid' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';

  @Prop() reference?: string;
  @Prop({ type: Date }) paidAt?: Date;
  @Prop() providerTxId?: string;
}
export const PaymentSchema = SchemaFactory.createForClass(Payment);

/** Événement de cycle de vie. Borné : une dizaine d'entrées au plus. */
@Schema({ _id: false })
export class TimelineEntry {
  @Prop({ type: String, enum: ORDER_STATUSES, required: true }) status!: OrderStatus;
  @Prop({ type: Date, default: () => new Date() }) at!: Date;
  @Prop({ type: Types.ObjectId, ref: 'User' }) byUserId?: Types.ObjectId;
  @Prop() note?: string;
}
export const TimelineEntrySchema = SchemaFactory.createForClass(TimelineEntry);

@Schema({ collection: 'orders', timestamps: true })
export class Order extends Document {
  /**
   * Séquence atomique + index unique.
   *
   * Le web produit `JM-<année>-<6 caractères de uniqid()>` : collision possible,
   * et non détectée puisqu'aucune contrainte d'unicité n'existe (§6.2).
   */
  @Prop({ required: true }) orderNumber!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ type: Object, required: true }) customer!: { name: string; phone: string };

  @Prop({ type: Types.ObjectId, ref: 'Shop', required: true }) shopId!: Types.ObjectId;
  @Prop({ type: Object, required: true })
  shop!: { name: string; slug: string; logo?: string };

  @Prop({ type: [OrderItemSchema], required: true }) items!: OrderItem[];

  @Prop({ type: Object, required: true })
  amounts!: {
    subtotal: unknown;
    shippingFee: unknown;
    discount: unknown;
    total: unknown;
  };

  @Prop({ type: Object }) coupon?: { code: string; type: string; value: unknown };

  @Prop({ type: DeliverySchema, default: () => ({}) }) delivery!: Delivery;
  @Prop({ type: PaymentSchema, required: true }) payment!: Payment;

  @Prop({ type: String, enum: ORDER_STATUSES, default: 'pending' })
  status!: OrderStatus;

  @Prop({ type: [TimelineEntrySchema], default: [] }) timeline!: TimelineEntry[];

  @Prop({ type: Types.ObjectId, ref: 'Invoice' }) invoiceId?: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type OrderDocument = HydratedDocument<Order>;
export const OrderSchema = SchemaFactory.createForClass(Order);

OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ shopId: 1, status: 1, createdAt: -1 });
OrderSchema.index({ 'delivery.courierId': 1, status: 1 });
OrderSchema.index({ 'payment.status': 1 });
