import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * Grand livre financier — §30. Chaque mouvement d'argent qui traverse la
 * plateforme (commission prélevée, frais de livraison encaissé, remboursement
 * émis, retrait versé) y dépose UNE ligne, immuable. Sans ce livre, « Revenus »
 * et « Rapports financiers » n'auraient que des requêtes d'agrégation ad hoc
 * sur `orders` pour toute preuve — aucune trace de ce qui a été effectivement
 * calculé et quand, et aucun moyen de rapprocher un chiffre affiché avec les
 * mouvements qui le composent.
 */
export const TRANSACTION_TYPES = [
  'commission',
  'delivery_fee',
  'refund',
  'merchant_withdrawal',
  'courier_withdrawal',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = ['pending', 'completed', 'rejected'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

@Schema({ collection: 'transactions', timestamps: { createdAt: true, updatedAt: false } })
export class Transaction extends Document {
  @Prop({ type: String, enum: TRANSACTION_TYPES, required: true, index: true })
  type!: TransactionType;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  amount!: unknown;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order' }) orderId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Shop' }) shopId?: Types.ObjectId;
  /** Bénéficiaire ou demandeur — livreur pour `courier_withdrawal`, propriétaire pour `merchant_withdrawal`. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' }) userId?: Types.ObjectId;

  @Prop({ type: String, enum: TRANSACTION_STATUSES, default: 'completed', index: true })
  status!: TransactionStatus;

  @Prop({ maxlength: 500 }) note?: string;

  createdAt!: Date;
}

export type TransactionDocument = HydratedDocument<Transaction>;
export const TransactionSchema = SchemaFactory.createForClass(Transaction);
TransactionSchema.index({ type: 1, createdAt: -1 });
TransactionSchema.index({ shopId: 1, createdAt: -1 });
