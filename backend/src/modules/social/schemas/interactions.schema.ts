import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

/**
 * Collections séparées — croissance NON BORNÉE.
 *
 * Embarquer ces documents dans `posts` ou `users` est l'antipatron principal de
 * MongoDB (§6.5) : plafond de 16 Mo par document, et réécriture intégrale du
 * document à chaque ajout. Une boutique populaire dépasserait la limite.
 */

@Schema({ collection: 'comments', timestamps: true })
export class Comment extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Post', required: true }) postId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ type: Object, required: true }) author!: { name: string; avatar?: string };
  @Prop({ required: true, maxlength: 2000 }) content!: string;
  /** Réponse à un commentaire : un seul niveau d'imbrication. */
  @Prop({ type: Types.ObjectId, ref: 'Comment', default: null })
  parentId!: Types.ObjectId | null;
  createdAt!: Date;
}
export type CommentDocument = HydratedDocument<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);
CommentSchema.index({ postId: 1, createdAt: -1 });
CommentSchema.index({ parentId: 1, createdAt: 1 });

export const REACTION_TYPES = ['like', 'love', 'haha', 'wow', 'sad', 'angry'] as const;

@Schema({ collection: 'reactions', timestamps: { createdAt: true, updatedAt: false } })
export class Reaction extends Document {
  @Prop({ type: String, enum: ['post', 'comment'], required: true })
  targetType!: 'post' | 'comment';
  @Prop({ type: Types.ObjectId, required: true }) targetId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
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
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) followerId!: Types.ObjectId;
  @Prop({ type: String, enum: ['user', 'shop'], required: true })
  targetType!: 'user' | 'shop';
  @Prop({ type: Types.ObjectId, required: true }) targetId!: Types.ObjectId;
  createdAt!: Date;
}
export type FollowDocument = HydratedDocument<Follow>;
export const FollowSchema = SchemaFactory.createForClass(Follow);
FollowSchema.index({ followerId: 1, targetType: 1, targetId: 1 }, { unique: true });
FollowSchema.index({ targetType: 1, targetId: 1 });

@Schema({ collection: 'favorites', timestamps: { createdAt: true, updatedAt: false } })
export class Favorite extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true }) productId!: Types.ObjectId;
  createdAt!: Date;
}
export type FavoriteDocument = HydratedDocument<Favorite>;
export const FavoriteSchema = SchemaFactory.createForClass(Favorite);
FavoriteSchema.index({ userId: 1, productId: 1 }, { unique: true });
