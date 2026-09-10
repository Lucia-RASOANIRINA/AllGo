import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

@Schema({ collection: 'courier_withdrawals', timestamps: true })
export class CourierWithdrawal extends Document {
  /** Entier MySQL (`users.id`) depuis la migration Auth (Phase 1). */
  @Prop({ type: Number, required: true, index: true })
  courierId!: number;

  @Prop({ required: true, min: 1 })
  amount!: number;

  @Prop({ required: true })
  method!: string;

  @Prop({ required: true })
  account!: string;

  @Prop({ type: String, enum: ['pending', 'paid', 'rejected'], default: 'pending', index: true })
  status!: 'pending' | 'paid' | 'rejected';

  createdAt!: Date;
  updatedAt!: Date;
}

export type CourierWithdrawalDocument = HydratedDocument<CourierWithdrawal>;
export const CourierWithdrawalSchema = SchemaFactory.createForClass(CourierWithdrawal);
