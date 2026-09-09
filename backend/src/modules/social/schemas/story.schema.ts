import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * Un viewer par utilisateur (dédoublonné dans `StoriesService.view`), sur une
 * fenêtre de 24 h avant expiration TTL : la liste reste par construction
 * bornée à l'audience d'une story, jamais à l'échelle de toute la plateforme
 * — contrairement aux commentaires ou réactions, elle n'a pas besoin d'une
 * collection séparée (§6.5).
 */
@Schema({ _id: false })
export class StoryViewer {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ required: true }) name!: string;
  @Prop() avatar?: string;
  @Prop({ type: Date, required: true }) viewedAt!: Date;
}
export const StoryViewerSchema = SchemaFactory.createForClass(StoryViewer);

@Schema({ collection: 'stories', timestamps: { createdAt: true, updatedAt: false } })
export class Story extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) authorId!: Types.ObjectId;
  @Prop({ type: Object, required: true }) author!: { name: string; avatar?: string };
  @Prop({ type: Object, required: true }) media!: { url: string; type: 'image' | 'video' };
  @Prop({ default: 0 }) viewCount!: number;
  @Prop({ default: 0 }) reactionCount!: number;
  @Prop({ type: [StoryViewerSchema], default: [] }) viewers!: StoryViewer[];

  /** Lien optionnel vers un produit ou une promotion (§12). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product' }) productId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Promotion' }) promotionId?: Types.ObjectId;

  /** Date de péremption — pilote l'index TTL ci-dessous. */
  @Prop({ type: Date, required: true }) expiresAt!: Date;

  createdAt!: Date;
}

export type StoryDocument = HydratedDocument<Story>;
export const StorySchema = SchemaFactory.createForClass(Story);

/**
 * Index TTL : MongoDB supprime automatiquement les stories expirées.
 *
 * Le web n'a aucun mécanisme de purge — sa table `stories` croît indéfiniment
 * (§6.2). Ici, la purge est une propriété de la base, pas une tâche planifiée
 * qu'on oublie de surveiller.
 */
StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
StorySchema.index({ authorId: 1, createdAt: -1 });
