import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * Jeton de rafraîchissement **rotatif** — §12.2.
 *
 * Chaque rafraîchissement révoque le jeton présenté et en émet un nouveau,
 * chaîné au précédent par `replacedBy`. Si un jeton déjà consommé est présenté
 * une seconde fois, c'est qu'il a été volé : toute la chaîne est alors invalidée
 * et l'utilisateur reconnecté. C'est la détection de vol de jeton standard.
 *
 * Seule l'empreinte SHA-256 du jeton est stockée : une fuite de la base ne
 * donne aucun jeton utilisable.
 */
@Schema({ collection: 'refreshTokens', timestamps: { createdAt: true, updatedAt: false } })
export class RefreshToken extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** Identifiant de session, reporté dans le JWT sous `sid`. */
  @Prop({ required: true }) sid!: string;

  @Prop({ required: true }) tokenHash!: string;

  @Prop({ type: Date }) revokedAt?: Date;
  @Prop() replacedBy?: string;

  @Prop() deviceId?: string;
  @Prop() userAgent?: string;
  @Prop() ip?: string;

  /** Purge automatique à l'expiration : la collection ne grossit pas sans fin. */
  @Prop({ type: Date, required: true }) expiresAt!: Date;

  createdAt!: Date;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

RefreshTokenSchema.index({ sid: 1 }, { unique: true });
RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
