import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * Liste noire de mots — alimente la modération automatique (§29) : toute
 * publication ou tout commentaire dont le contenu contient l'une de ces
 * entrées est masqué et signalé dès sa création, sans attendre un signalement
 * humain.
 */
@Schema({ collection: 'banned_words', timestamps: { createdAt: true, updatedAt: false } })
export class BannedWord extends Document {
  @Prop({ required: true, trim: true, lowercase: true, unique: true, maxlength: 100 }) word!: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) addedBy!: Types.ObjectId;
  createdAt!: Date;
}

export type BannedWordDocument = HydratedDocument<BannedWord>;
export const BannedWordSchema = SchemaFactory.createForClass(BannedWord);
