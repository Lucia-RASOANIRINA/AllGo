import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/** Retrait commerçant — même motif que `CourierWithdrawal` (courier-earnings), pour les boutiques plutôt que les livreurs. */
@Schema({ collection: 'merchant_withdrawals', timestamps: true })
export class MerchantWithdrawal extends Document {
  /** Entier MySQL (`shops.id`) depuis la migration des Boutiques (Phase 2). */
  @Prop({ type: Number, required: true, index: true })
  shopId!: number;

  /** Entier MySQL (`users.id`) depuis la migration Auth (Phase 1). */
  @Prop({ type: Number, required: true })
  ownerId!: number;

  @Prop({ type: MongooseSchema.Types.Decimal128, required: true })
  amount!: unknown;

  @Prop({ required: true }) method!: string;
  @Prop({ required: true }) account!: string;

  @Prop({ type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending', index: true })
  status!: 'pending' | 'paid' | 'rejected';

  createdAt!: Date;
  updatedAt!: Date;
}

export type MerchantWithdrawalDocument = HydratedDocument<MerchantWithdrawal>;
export const MerchantWithdrawalSchema = SchemaFactory.createForClass(MerchantWithdrawal);
