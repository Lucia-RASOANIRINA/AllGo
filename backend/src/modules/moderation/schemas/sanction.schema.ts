import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export const SANCTION_TYPES = ['warning', 'suspension', 'ban'] as const;
export type SanctionType = (typeof SANCTION_TYPES)[number];

/**
 * Sanction — trace permanente d'une décision de modération sur un compte,
 * distincte de `User.status` qui ne porte que l'état COURANT (§3). Un compte
 * réactivé après une suspension doit rester consultable dans son historique :
 * `User.status` seul ne le permettrait pas, il écrase l'état précédent.
 */
@Schema({ collection: 'sanctions', timestamps: { createdAt: true, updatedAt: false } })
export class Sanction extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ type: String, enum: SANCTION_TYPES, required: true }) type!: SanctionType;
  @Prop({ required: true, trim: true, maxlength: 500 }) reason!: string;
  @Prop({ type: Types.ObjectId, ref: 'Report' }) reportId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) issuedBy!: Types.ObjectId;
  /** Absente pour un avertissement ou une exclusion définitive ; posée pour une suspension temporaire. */
  @Prop({ type: Date }) expiresAt?: Date;
  createdAt!: Date;
}

export type SanctionDocument = HydratedDocument<Sanction>;
export const SanctionSchema = SchemaFactory.createForClass(Sanction);
SanctionSchema.index({ userId: 1, createdAt: -1 });
