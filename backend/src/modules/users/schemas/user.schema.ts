import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { Role } from '../../../common/rbac/roles';

/** Point GeoJSON. Ordre des coordonnées : **[longitude, latitude]** (§15.4). */
@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point' })
  type!: 'Point';

  @Prop({ type: [Number], required: true })
  coordinates!: [number, number];
}
export const GeoPointSchema = SchemaFactory.createForClass(GeoPoint);

/** Rôle attribué, avec sa portée éventuelle — §3.1. */
@Schema({ _id: false })
export class RoleAssignment {
  @Prop({ type: String, enum: Object.values(Role), required: true })
  role!: Role;

  /** Portée du rôle. Requis pour tout rôle de boutique, absent pour les rôles globaux. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Shop' })
  shopId?: Types.ObjectId;
}
export const RoleAssignmentSchema = SchemaFactory.createForClass(RoleAssignment);

/** Adresse de livraison. Embarquée : le nombre est borné (quelques unités). */
@Schema({ _id: true })
export class Address {
  @Prop({ required: true }) label!: string;
  @Prop({ required: true }) city!: string;
  @Prop() district?: string;
  @Prop({ required: true }) line!: string;
  @Prop({ type: GeoPointSchema }) location?: GeoPoint;
  @Prop({ default: false }) isDefault!: boolean;
}
export const AddressSchema = SchemaFactory.createForClass(Address);

/** Terminal enregistré pour les notifications push. Borné : quelques appareils. */
@Schema({ _id: false })
export class Device {
  @Prop({ required: true }) deviceId!: string;
  @Prop({ required: true }) fcmToken!: string;
  @Prop({ type: String, enum: ['android', 'ios'], required: true })
  platform!: 'android' | 'ios';
  @Prop({ type: Date, default: () => new Date() }) lastSeenAt!: Date;
}
export const DeviceSchema = SchemaFactory.createForClass(Device);

@Schema({ _id: false })
export class Preferences {
  @Prop({ type: String, enum: ['fr', 'mg'], default: 'fr' }) locale!: 'fr' | 'mg';
  @Prop({ type: String, enum: ['light', 'dark', 'system'], default: 'system' })
  theme!: 'light' | 'dark' | 'system';
  @Prop({ default: true }) pushEnabled!: boolean;
  /** Coupures fines par catégorie de notification — §10.2. */
  @Prop({ type: Map, of: Boolean, default: {} }) pushCategories!: Map<string, boolean>;
}
export const PreferencesSchema = SchemaFactory.createForClass(Preferences);

@Schema({ collection: 'users', timestamps: true })
export class User extends Document {
  /**
   * Pont d'identité transitoire — migration Mongo → MySQL (§ décision du
   * 2026-09-09). L'authentification et le profil canonique vivent désormais
   * dans `users` (MySQL, `PrismaService`) ; ce document Mongo devient un
   * MIROIR tenu à jour à la connexion/l'inscription/la modification de
   * profil, conservé pour les 169 sites d'appel des modules pas encore
   * migrés qui font `new Types.ObjectId(user.id)`/`.populate('userId')` et
   * attendent un vrai document `User` (nom, avatar, rôles...) à cette
   * référence. Disparaît avec le dernier module migré.
   */
  @Prop({ type: Number })
  mysqlId?: number;

  // L'unicité est portée par les index déclarés en bas de fichier, jamais par
  // `unique: true` sur le champ : les deux ensemble créent l'index deux fois.
  @Prop({ required: true, trim: true })
  phone!: string;

  @Prop({ lowercase: true, trim: true })
  email?: string;

  /**
   * Empreinte Argon2id du mot de passe.
   *
   * `select: false` : jamais renvoyée par une requête ordinaire. Il faut la
   * demander explicitement (`.select('+passwordHash')`), ce qui rend une fuite
   * accidentelle par sérialisation impossible.
   *
   * La colonne `temp_password` du web, qui stocke les mots de passe en clair,
   * n'est PAS reprise (§6.2, §12.1).
   */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ required: true, trim: true }) firstName!: string;
  @Prop({ required: true, trim: true }) lastName!: string;
  @Prop() avatar?: string;
  @Prop() cover?: string;
  @Prop({ maxlength: 500 }) bio?: string;
  @Prop({ type: Date }) birthDate?: Date;
  @Prop({ type: String, enum: ['male', 'female', 'other'] }) gender?: string;
  @Prop({ type: Object, default: {} })
  courierProfile?: {
    identityVerified: boolean;
    vehicle?: string;
    documents: string[];
    available: boolean;
  };

  @Prop({ type: String, enum: ['active', 'suspended', 'pending'], default: 'active' })
  status!: 'active' | 'suspended' | 'pending';

  @Prop({ type: [RoleAssignmentSchema], default: () => [{ role: Role.Client }] })
  roles!: RoleAssignment[];

  @Prop({ type: [AddressSchema], default: [] }) addresses!: Address[];
  @Prop({ type: [DeviceSchema], default: [] }) devices!: Device[];
  @Prop({ type: PreferencesSchema, default: () => ({}) }) preferences!: Preferences;

  @Prop({ type: Object, default: { isOnline: false } })
  presence!: { isOnline: boolean; lastSeenAt?: Date };

  @Prop({ type: Date }) emailVerifiedAt?: Date;
  @Prop({ type: Date }) phoneVerifiedAt?: Date;

  /** Invalide tout jeton d'accès émis avant cette date (réinitialisation de mot de passe). */
  @Prop({ type: Date }) sessionsInvalidBefore?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ phone: 1 }, { unique: true });
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ mysqlId: 1 }, { unique: true, sparse: true });
UserSchema.index({ 'roles.shopId': 1, 'roles.role': 1 });
UserSchema.index({ 'addresses.location': '2dsphere' });

/** Aucune empreinte ni donnée interne ne franchit jamais la frontière JSON. */
UserSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, returned) => {
    const ret = returned as unknown as Record<string, unknown>;
    ret.id = ret._id;
    delete ret._id;
    delete ret.passwordHash;
    delete ret.sessionsInvalidBefore;
    return ret;
  },
});
