import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

/**
 * Avis client sur un PRODUIT — schéma séparé de `Review` (boutiques), pas un
 * `productId?` optionnel dessus : la clé unique et la cible de recalcul
 * (`Product.stats` vs `Shop.stats`) sont complètement disjointes. Dupliquer ce
 * petit schéma reste plus lisible qu'une union polymorphe. Même structure que
 * `backend/src/modules/shops/schemas/review.schema.ts`.
 */
@Schema({ collection: 'productReviews', timestamps: { createdAt: true, updatedAt: false } })
export class ProductReview extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true }) productId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;

  @Prop({ type: Object, required: true })
  author!: { name: string; avatar?: string };

  @Prop({ required: true, min: 1, max: 5 }) rating!: number;
  @Prop({ maxlength: 1000 }) comment?: string;

  createdAt!: Date;
}

export type ProductReviewDocument = HydratedDocument<ProductReview>;
export const ProductReviewSchema = SchemaFactory.createForClass(ProductReview);
ProductReviewSchema.index({ productId: 1, userId: 1 }, { unique: true });
ProductReviewSchema.index({ productId: 1, createdAt: -1 });
