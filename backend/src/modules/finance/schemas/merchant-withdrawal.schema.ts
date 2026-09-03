import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/** Retrait commerçant — même motif que `CourierWithdrawal` (courier-earnings), pour les boutiques plutôt que les livreurs. */
@Schema({ collection: 'merchant_withdrawals', timestamps: true })
export class MerchantWithdrawal extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Shop', required: true, index: true })
  shopId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  ownerId!: Types.ObjectId;

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
