import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'promotions', timestamps: true })
export class Promotion extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Shop', required: true }) shopId!: Types.ObjectId;
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ type: String, enum: ['percent', 'fixed', 'price'], required: true }) type!: string;
  @Prop({ required: true, min: 0 }) value!: number;
  @Prop({ type: Date, required: true }) startsAt!: Date;
  @Prop({ type: Date, required: true }) endsAt!: Date;
  @Prop({ min: 1 }) quantityLimit?: number;
  @Prop() couponCode?: string;
  @Prop({ default: false }) flash!: boolean;
  @Prop({ default: false }) specialOffer!: boolean;
  @Prop({ type: Object }) location?: { latitude: number; longitude: number; radiusKm: number };
  @Prop({ type: Types.ObjectId, ref: 'Product' }) productId?: Types.ObjectId;
  @Prop({ default: true }) active!: boolean;
}
export type PromotionDocument = HydratedDocument<Promotion>;
export const PromotionSchema = SchemaFactory.createForClass(Promotion);
PromotionSchema.index({ shopId: 1, startsAt: 1, endsAt: 1 });
