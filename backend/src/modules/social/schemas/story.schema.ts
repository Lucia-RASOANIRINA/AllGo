import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'stories', timestamps: { createdAt: true, updatedAt: false } })
export class Story extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) authorId!: Types.ObjectId;
  @Prop({ type: Object, required: true }) author!: { name: string; avatar?: string };
  @Prop({ type: Object, required: true }) media!: { url: string; type: 'image' | 'video' };
  @Prop({ default: 0 }) viewCount!: number;

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
