import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

export const DISPUTE_STATUSES = ['open', 'resolved', 'rejected'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * Litige — ouvert par le client sur une commande, traité par la modération
 * plateforme (§28). Collection séparée plutôt qu'un champ sur `Order` : un
 * litige a son propre cycle de vie (ouvert → résolu/rejeté) et peut porter un
 * second litige sur la même commande une fois le premier clos.
 */
@Schema({ collection: 'disputes', timestamps: true })
export class Dispute extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order', required: true, index: true }) orderId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true }) raisedBy!: Types.ObjectId;
  @Prop({ required: true, trim: true, maxlength: 2000 }) reason!: string;

  @Prop({ type: String, enum: DISPUTE_STATUSES, default: 'open', index: true })
  status!: DisputeStatus;

  @Prop({ maxlength: 2000 }) resolution?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' }) resolvedBy?: Types.ObjectId;
  @Prop({ type: Date }) resolvedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type DisputeDocument = HydratedDocument<Dispute>;
export const DisputeSchema = SchemaFactory.createForClass(Dispute);
DisputeSchema.index({ status: 1, createdAt: -1 });
