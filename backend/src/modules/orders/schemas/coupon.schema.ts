import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * Code de réduction — schéma volontairement minimal (§ décisions de portée) :
 * pas de plafond par utilisateur, pas de restriction par catégorie, pas de
 * cumul entre coupons. Aucune interface de gestion commerçant cette session :
 * les coupons sont créés à la main (`mongosh`), seule la rédemption côté
 * client est construite.
 */
@Schema({ collection: 'coupons', timestamps: true })
export class Coupon extends Document {
  @Prop({ required: true, unique: true, uppercase: true, trim: true }) code!: string;

  /** Vide = valable sur toutes les boutiques. */
  @Prop({ type: Types.ObjectId, ref: 'Shop' }) shopId?: Types.ObjectId;

  @Prop({ type: String, enum: ['percent', 'fixed'], required: true })
  discountType!: 'percent' | 'fixed';

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true }) discountValue!: unknown;

  @Prop({ type: MongooseSchema.Types.Decimal128 }) minOrderAmount?: unknown;

  /** Plafonne une réduction `percent` — sans effet sur `fixed`. */
  @Prop({ type: MongooseSchema.Types.Decimal128 }) maxDiscount?: unknown;

  @Prop({ type: Date }) expiresAt?: Date;

  @Prop() usageLimit?: number;
  @Prop({ default: 0 }) usageCount!: number;

  @Prop({ default: true }) active!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export type CouponDocument = HydratedDocument<Coupon>;
export const CouponSchema = SchemaFactory.createForClass(Coupon);
CouponSchema.index({ code: 1 }, { unique: true });
