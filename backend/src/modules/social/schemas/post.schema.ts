import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { GeoPoint, GeoPointSchema } from '../../users/schemas/user.schema';
import { Media, MediaSchema } from '../../catalog/schemas/product.schema';

/** Détail d'une demande client — présent uniquement si `kind === 'request'`. */
@Schema({ _id: false })
export class RequestDetail {
  @Prop({ type: String, enum: ['search', 'need', 'buy'], required: true }) type!: string;
  @Prop({ required: true }) title!: string;
  @Prop() description?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Category' }) categoryId?: Types.ObjectId;
  @Prop() quantity?: number;
  @Prop({ type: MongooseSchema.Types.Decimal128 }) budget?: unknown;
  @Prop({ type: Date }) desiredDate?: Date;

  @Prop({ type: String, enum: ['normal', 'urgent', 'very_urgent'], default: 'normal' })
  urgency!: string;

  @Prop({ type: String, enum: ['active', 'discussing', 'done', 'expired'], default: 'active' })
  status!: string;

  @Prop({ default: 0 }) responseCount!: number;
}
export const RequestDetailSchema = SchemaFactory.createForClass(RequestDetail);

/**
 * Publication du fil social.
 *
 * **Unification** (§6.2) : le web maintient deux systèmes parallèles — la table
 * `posts`, enrichie de 8 colonnes de demande par `add_post_fields.sql`, ET une
 * table `client_requests` séparée portant les mêmes informations. Les deux
 * coexistent. Ici, un seul document, discriminé par `kind`.
 */
@Schema({ collection: 'posts', timestamps: true })
export class Post extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) authorId!: Types.ObjectId;

  /** Instantané d'affichage : le fil se rend sans une seule jointure. */
  @Prop({ type: Object, required: true })
  author!: {
    name: string;
    avatar?: string;
    type: 'user' | 'shop';
    shopId?: Types.ObjectId;
  };

  @Prop({ type: String, enum: ['post', 'request'], default: 'post' })
  kind!: 'post' | 'request';

  @Prop({ maxlength: 5000 }) content?: string;
  @Prop({ type: [MediaSchema], default: [] }) media!: Media[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product' }) productId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Promotion' }) promotionId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Shop' }) shopId?: Types.ObjectId;
  @Prop({ type: Date }) scheduledAt?: Date;
  @Prop({ type: Object }) product?: { name: string; price: unknown; image?: string };

  @Prop({ type: RequestDetailSchema }) request?: RequestDetail;

  @Prop({ type: String, enum: ['public', 'followers'], default: 'public' })
  visibility!: 'public' | 'followers';

  @Prop({ type: GeoPointSchema }) location?: GeoPoint;

  /**
   * Compteurs incrémentaux (`$inc`), jamais recalculés par `count()`.
   * Les commentaires et réactions vivent dans des collections séparées :
   * un tableau embarqué croîtrait sans limite (§6.5).
   */
  @Prop({ type: Object, default: { reactions: 0, comments: 0, shares: 0, views: 0 } })
  counters!: { reactions: number; comments: number; shares: number; views: number };

  @Prop({ type: [String], default: [] }) hashtags!: string[];

  /** Modération — même motif que `Review.reported`/`reportReason`. */
  @Prop({ default: false, index: true }) reported!: boolean;
  @Prop() reportReason?: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export type PostDocument = HydratedDocument<Post>;
export const PostSchema = SchemaFactory.createForClass(Post);

PostSchema.index({ authorId: 1, createdAt: -1 });
PostSchema.index({ visibility: 1, createdAt: -1 });
PostSchema.index({ kind: 1, 'request.status': 1, 'request.categoryId': 1 });
PostSchema.index({ hashtags: 1 });
PostSchema.index({ location: '2dsphere' });
