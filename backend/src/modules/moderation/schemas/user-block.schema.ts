import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

/**
 * Blocage générique compte-à-compte — distinct du blocage de conversation
 * (`Conversation.blockedBy`, messagerie uniquement). Celui-ci a une portée
 * plus large : il ferme aussi la messagerie entre les deux comptes (défense en
 * profondeur avec le blocage de conversation) et masque les publications du
 * compte bloqué du fil de celui qui bloque (§29).
 */
@Schema({ collection: 'user_blocks', timestamps: { createdAt: true, updatedAt: false } })
export class UserBlock extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) blockerId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) blockedId!: Types.ObjectId;
  createdAt!: Date;
}

export type UserBlockDocument = HydratedDocument<UserBlock>;
export const UserBlockSchema = SchemaFactory.createForClass(UserBlock);
UserBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
UserBlockSchema.index({ blockedId: 1 });
