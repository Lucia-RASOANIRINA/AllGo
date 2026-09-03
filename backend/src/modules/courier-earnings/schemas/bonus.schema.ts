import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * Bonus accordé à un livreur — décision humaine de la modération plateforme,
 * jamais une formule automatique : rien dans le cahier des charges ne définit
 * de règle de bonus, et en inventer une serait fabriquer une politique
 * commerciale qui n'a été demandée nulle part. Un montant + un motif tracés
 * restent auditables, contrairement à un champ à 0 jamais alimenté.
 */
@Schema({ collection: 'courier_bonuses', timestamps: true })
export class CourierBonus extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  courierId!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ required: true, trim: true, maxlength: 300 })
  reason!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  grantedBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type CourierBonusDocument = HydratedDocument<CourierBonus>;
export const CourierBonusSchema = SchemaFactory.createForClass(CourierBonus);
CourierBonusSchema.index({ courierId: 1, createdAt: -1 });
