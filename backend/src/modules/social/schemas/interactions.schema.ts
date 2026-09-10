import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * Collections séparées — croissance NON BORNÉE.
 *
 * Embarquer ces documents dans `posts` ou `users` est l'antipatron principal de
 * MongoDB (§6.5) : plafond de 16 Mo par document, et réécriture intégrale du
 * document à chaque ajout. Une boutique populaire dépasserait la limite.
 */

@Schema({ collection: 'comments', timestamps: true })
export class Comment extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true }) postId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ type: Object, required: true }) author!: { name: string; avatar?: string };
  @Prop({ required: true, maxlength: 2000 }) content!: string;
  /** Réponse à un commentaire : un seul niveau d'imbrication. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Comment', default: null })
  parentId!: Types.ObjectId | null;
  /** Même motif que `Post.reported` (§22) : un drapeau posé par un signalement ou le filtre automatique, jamais une suppression. */
  @Prop({ type: Boolean, default: false, index: true }) reported!: boolean;
  @Prop({ maxlength: 300 }) reportReason?: string;
  createdAt!: Date;
}
export type CommentDocument = HydratedDocument<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ postId: 1, createdAt: -1 });
CommentSchema.index({ parentId: 1, createdAt: 1 });

export const REACTION_TYPES = ['like', 'love', 'haha', 'wow', 'sad', 'angry'] as const;

@Schema({ collection: 'reactions', timestamps: { createdAt: true, updatedAt: false } })
export class Reaction extends Document {
  @Prop({ type: String, enum: ['post', 'comment', 'story'], required: true })
  targetType!: 'post' | 'comment' | 'story';
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) targetId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ type: String, enum: REACTION_TYPES, required: true }) type!: string;
  createdAt!: Date;
}
export type ReactionDocument = HydratedDocument<Reaction>;
export const ReactionSchema = SchemaFactory.createForClass(Reaction);
// Index unique composé : une seule réaction par utilisateur et par cible.
// La règle est portée par la base, pas par le code applicatif.
ReactionSchema.index({ targetId: 1, userId: 1 }, { unique: true });

@Schema({ collection: 'follows', timestamps: { createdAt: true, updatedAt: false } })
export class Follow extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) followerId!: Types.ObjectId;
  @Prop({ type: String, enum: ['user', 'shop'], required: true })
  targetType!: 'user' | 'shop';
  /**
   * ObjectId pour `targetType: 'user'` (miroir Mongo, § décision du
   * 2026-09-09) ; entier MySQL pour `targetType: 'shop'` depuis la migration
   * du module Boutiques (Phase 2) — d'où un type non contraint (`Mixed`)
   * plutôt qu'un `ObjectId` strict.
   */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) targetId!: Types.ObjectId | number;
  createdAt!: Date;
}
export type FollowDocument = HydratedDocument<Follow>;
export const FollowSchema = SchemaFactory.createForClass(Follow);
FollowSchema.index({ followerId: 1, targetType: 1, targetId: 1 }, { unique: true });
FollowSchema.index({ targetType: 1, targetId: 1 });

/** Cibles favorisables — §10. Un produit reste le cas d'usage dominant. */
export const FAVORITABLE_TYPES = ['product', 'shop', 'promotion', 'post'] as const;
export type FavoriteTargetType = (typeof FAVORITABLE_TYPES)[number];

/**
 * Générique (`targetType`/`targetId`), sur le même motif que `Follow` et
 * `Reaction` ci-dessus — plutôt qu'un champ dédié par type de cible, qui
 * aurait fallu dupliquer à chaque nouveau type favorisable.
 */
@Schema({ collection: 'favorites', timestamps: { createdAt: true, updatedAt: false } })
export class Favorite extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ type: String, enum: FAVORITABLE_TYPES, required: true }) targetType!: FavoriteTargetType;
  /** Entier MySQL pour `product`/`shop` (Phase 2) ; ObjectId Mongo pour `promotion`/`post` (pas encore migrés). */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) targetId!: Types.ObjectId | number;
  createdAt!: Date;
}
export type FavoriteDocument = HydratedDocument<Favorite>;
export const FavoriteSchema = SchemaFactory.createForClass(Favorite);
FavoriteSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });
FavoriteSchema.index({ userId: 1, targetType: 1, createdAt: -1 });
