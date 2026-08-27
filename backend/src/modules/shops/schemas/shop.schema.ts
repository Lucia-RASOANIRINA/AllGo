import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';
import { GeoPoint, GeoPointSchema } from '../../users/schemas/user.schema';
import { Role } from '../../../common/rbac/roles';

/**
 * Membre d'équipe. Embarqué : quelques dizaines au plus par boutique.
 *
 * Remplace `shop_team_members`, dont la contrainte `UNIQUE` sur `user_id`
 * empêchait un utilisateur d'appartenir à deux boutiques (§3.1).
 */
@Schema({ _id: false })
export class TeamMember {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
  @Prop({ required: true }) name!: string;
  @Prop() avatar?: string;
  @Prop({ type: String, enum: Object.values(Role), required: true }) role!: Role;
  @Prop({ type: String, enum: ['active', 'suspended'], default: 'active' })
  status!: 'active' | 'suspended';
  @Prop({ type: Types.ObjectId, ref: 'User' }) invitedBy?: Types.ObjectId;
  @Prop({ type: Date, default: () => new Date() }) joinedAt!: Date;
}
export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember);

@Schema({ _id: false })
export class OpeningHours {
  /** Jour ISO : 1 = lundi … 7 = dimanche. */
  @Prop({ min: 1, max: 7, required: true }) day!: number;
  @Prop({ required: true }) open!: string;
  @Prop({ required: true }) close!: string;
}
export const OpeningHoursSchema = SchemaFactory.createForClass(OpeningHours);

@Schema({ collection: 'shops', timestamps: true })
export class Shop extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) ownerId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true }) slug!: string;
  @Prop({ required: true, trim: true }) name!: string;
  @Prop() description?: string;
  @Prop() logo?: string;
  @Prop() banner?: string;

  @Prop({ type: Types.ObjectId, ref: 'Category' }) categoryId?: Types.ObjectId;
  /** Instantané d'affichage : évite une jointure sur chaque carte de boutique. */
  @Prop() categoryName?: string;

  @Prop({ type: Object, default: {} })
  contact!: { phone?: string; whatsapp?: string; facebook?: string; instagram?: string };

  @Prop({ type: Object, default: {} })
  address!: { city?: string; line?: string };

  /**
   * Position de la boutique. Indexée en `2dsphere` : c'est le gain le plus net
   * de MongoDB sur ce projet (§6.2, annexe C). Le web calcule aujourd'hui une
   * formule de Haversine écrite à la main en SQL, sans index possible.
   */
  @Prop({ type: GeoPointSchema }) location?: GeoPoint;

  @Prop({ default: 5 }) deliveryRadiusKm!: number;

  @Prop({ type: [OpeningHoursSchema], default: [] }) openingHours!: OpeningHours[];
  @Prop({ type: [TeamMemberSchema], default: [] }) team!: TeamMember[];

  @Prop({
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending',
  })
  status!: 'pending' | 'approved' | 'rejected' | 'suspended';

  @Prop({ default: false }) isFeatured!: boolean;

  /** Compteurs incrémentaux — évitent un `count()` sur chaque affichage. */
  @Prop({
    type: Object,
    default: { productCount: 0, orderCount: 0, rating: 0, reviewCount: 0, followerCount: 0 },
  })
  stats!: {
    productCount: number;
    orderCount: number;
    rating: number;
    reviewCount: number;
    followerCount: number;
  };

  createdAt!: Date;
  updatedAt!: Date;
}

export type ShopDocument = HydratedDocument<Shop>;
export const ShopSchema = SchemaFactory.createForClass(Shop);

ShopSchema.index({ slug: 1 }, { unique: true });
ShopSchema.index({ location: '2dsphere' });
ShopSchema.index({ status: 1, isFeatured: -1 });
ShopSchema.index({ 'team.userId': 1 });
ShopSchema.index({ name: 'text', description: 'text' }, { weights: { name: 10, description: 2 } });
