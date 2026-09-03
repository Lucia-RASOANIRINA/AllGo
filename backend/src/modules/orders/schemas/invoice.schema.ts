import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { OrderItemSchema, type OrderItem } from './order.schema';

/**
 * Facture — **unifie les deux systèmes concurrents du web** (§6.2) :
 * `invoices` et `sales_invoices` portaient les mêmes informations dans deux
 * tables distinctes, avec deux numérotations indépendantes.
 */
@Schema({ collection: 'invoices', timestamps: true })
export class Invoice extends Document {
  @Prop({ required: true }) invoiceNumber!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', required: true }) orderId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Shop', required: true }) shopId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;

  /** Instantané du client au moment de l'émission — une facture ne se réécrit jamais. */
  @Prop({ type: Object, required: true })
  customer!: { name: string; phone: string; address?: string };

  @Prop({ type: [OrderItemSchema], required: true }) items!: OrderItem[];

  @Prop({ type: Object, required: true })
  amounts!: { subtotal: unknown; shippingFee: unknown; discount: unknown; total: unknown };

  @Prop({ type: String, enum: ['draft', 'issued', 'paid', 'cancelled'], default: 'issued' })
  status!: string;

  @Prop({ required: true }) paymentMethod!: string;
  @Prop({ type: Date }) issuedAt?: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' }) issuedBy?: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type InvoiceDocument = HydratedDocument<Invoice>;
export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
InvoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
InvoiceSchema.index({ shopId: 1, createdAt: -1 });
InvoiceSchema.index({ orderId: 1 });

@Schema({ collection: 'refunds', timestamps: true })
export class Refund extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', required: true }) orderId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Shop', required: true }) shopId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.Decimal128, required: true }) amount!: unknown;
  @Prop({ required: true }) reason!: string;
  @Prop({ type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' })
  status!: string;
  @Prop() providerRefundId?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) createdBy!: Types.ObjectId;
  createdAt!: Date;
}

export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);
RefundSchema.index({ orderId: 1 });
