import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/** Cibles signalables — §29. Une par type de contenu ou de compte modérable. */
export const REPORT_TARGET_TYPES = ['post', 'comment', 'user', 'shop', 'product', 'conversation'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_REASON_CODES = [
  'spam',
  'abuse',
  'nudity',
  'scam',
  'counterfeit',
  'automatic_filter',
  'other',
] as const;
export type ReportReasonCode = (typeof REPORT_REASON_CODES)[number];

export const REPORT_STATUSES = ['pending', 'dismissed', 'actioned'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_ACTIONS = ['none', 'content_removed', 'warning', 'suspension', 'ban'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/**
 * Signalement — collection dédiée plutôt que le drapeau booléen isolé déjà
 * posé sur `Post`/`Conversation`/`Review` (§22, §11) : cinq types de cibles
 * (publication, commentaire, utilisateur, boutique, produit) partagent ici la
 * même file d'attente de modération, avec l'identité du signalant, un motif
 * qualifié et un cycle de vie (en attente → classé sans suite / sanctionné) —
 * ce qu'un simple booléen par schéma ne peut pas porter.
 */
@Schema({ collection: 'reports', timestamps: true })
export class Report extends Document {
  /** `null` pour un signalement déposé par le filtre automatique, pas un compte. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null }) reporterId!: Types.ObjectId | null;
  @Prop({ type: String, enum: REPORT_TARGET_TYPES, required: true }) targetType!: ReportTargetType;
  /** Entier MySQL pour `product`/`shop` (Phase 2) ; ObjectId (miroir) pour `post`/`comment`/`user`. */
  @Prop({ type: MongooseSchema.Types.Mixed, required: true }) targetId!: Types.ObjectId | number;
  @Prop({ required: true, trim: true, maxlength: 500 }) reason!: string;
  @Prop({ type: String, enum: REPORT_REASON_CODES, default: 'other' }) reasonCode!: ReportReasonCode;
  @Prop({ type: Boolean, default: false }) automatic!: boolean;

  @Prop({ type: String, enum: REPORT_STATUSES, default: 'pending', index: true }) status!: ReportStatus;
  @Prop({ type: String, enum: REPORT_ACTIONS, default: 'none' }) action!: ReportAction;
  @Prop({ maxlength: 2000 }) resolution?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' }) resolvedBy?: Types.ObjectId;
  @Prop({ type: Date }) resolvedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ targetType: 1, targetId: 1, status: 1 });
