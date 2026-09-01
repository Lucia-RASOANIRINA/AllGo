import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'courier_withdrawals', timestamps: true })
export class CourierWithdrawal extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  courierId!: Types.ObjectId;

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
