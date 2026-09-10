import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export const REVIEW_TARGETS = ['product', 'shop', 'courier'] as const;
export type ReviewTarget = (typeof REVIEW_TARGETS)[number];

@Schema({ collection: 'reviews', timestamps: true })
export class Review extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  /** Identifiant entier MySQL (`orders.id`) depuis la migration des Commandes (Phase 3). */
  @Prop({ type: Number, required: true }) orderId!: number;
  @Prop({ type: String, enum: REVIEW_TARGETS, required: true }) targetType!: ReviewTarget;
  /** Entier MySQL pour `product`/`shop` (Phase 2) ; ObjectId (miroir) pour `courier`. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) targetId!: Types.ObjectId | number;
  @Prop({ required: true, min: 1, max: 5 }) rating!: number;
  @Prop({ trim: true, maxlength: 2000 }) comment?: string;
  @Prop({ type: [String], default: [] }) photos!: string[];
  @Prop({ default: true }) verified!: boolean;
  @Prop({ default: false }) reported!: boolean;
  @Prop() reportReason?: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ userId: 1, orderId: 1, targetType: 1, targetId: 1 }, { unique: true });
ReviewSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
