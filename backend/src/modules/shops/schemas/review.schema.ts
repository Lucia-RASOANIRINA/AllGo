import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

/**
 * Avis client sur une boutique. Collection séparée, pas un tableau embarqué
 * dans `Shop` — une boutique populaire accumulerait des centaines d'avis, et
 * `Shop` resterait un document léger, lu à chaque affichage de fiche (§6.5,
 * même raisonnement que `Comment`/`Reaction`).
 *
 * Un avis par client et par boutique : l'index unique le garantit, pas une
 * vérification applicative préalable (fenêtre de concurrence).
 */
@Schema({ collection: 'reviews', timestamps: { createdAt: true, updatedAt: false } })
export class Review extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Shop', required: true }) shopId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;

  /** Instantané d'affichage : la liste d'avis se rend sans jointure. */
  @Prop({ type: Object, required: true })
  author!: { name: string; avatar?: string };

  @Prop({ required: true, min: 1, max: 5 }) rating!: number;
  @Prop({ maxlength: 1000 }) comment?: string;

  createdAt!: Date;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ shopId: 1, userId: 1 }, { unique: true });
ReviewSchema.index({ shopId: 1, createdAt: -1 });
