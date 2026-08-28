import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { GeoPoint, GeoPointSchema } from '../../users/schemas/user.schema';

@Schema({ _id: false })
export class Media {
  @Prop({ required: true }) url!: string;
  @Prop() thumbUrl?: string;
  @Prop() previewUrl?: string;
  @Prop({ type: String, enum: ['image', 'video'], default: 'image' })
  type!: 'image' | 'video';
  @Prop({ default: false }) isMain!: boolean;
  @Prop({ default: 0 }) order!: number;
}
export const MediaSchema = SchemaFactory.createForClass(Media);

@Schema({ _id: true })
export class Variant {
  @Prop({ required: true }) name!: string;
  @Prop() sku?: string;
  /** Écart de prix par rapport au prix de base, en Ariary. */
  @Prop({ type: MongooseSchema.Types.Decimal128, default: 0 }) priceDelta!: unknown;
  @Prop({ default: 0, min: 0 }) stock!: number;
}
export const VariantSchema = SchemaFactory.createForClass(Variant);

@Schema({ collection: 'products', timestamps: true })
export class Product extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Shop', required: true })
  shopId!: Types.ObjectId;

  /** Instantané d'affichage de la boutique : une fiche produit se rend sans jointure. */
  @Prop({ type: Object, required: true })
  shop!: { name: string; slug: string; logo?: string; city?: string };

  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ required: true, lowercase: true }) slug!: string;
  @Prop() description?: string;
  @Prop() sku?: string;

  /** Code-barres : permet l'identification par scan (§2.2). */
  @Prop() barcode?: string;

  @Prop({ type: Types.ObjectId, ref: 'Category' }) categoryId?: Types.ObjectId;

  /**
   * Ancêtres matérialisés. Récupère en une requête indexée tous les produits
   * d'une catégorie ET de ses sous-catégories — ce qui exige aujourd'hui une
   * jointure récursive en SQL.
   */
  @Prop({ type: [Types.ObjectId], default: [] }) categoryPath!: Types.ObjectId[];

  /**
   * Montants en `Decimal128`, jamais en `Double` (§15.4).
   * Un arrondi flottant sur un prix en Ariary est inacceptable.
   */
  @Prop({ type: MongooseSchema.Types.Decimal128, required: true }) price!: unknown;
  @Prop({ type: MongooseSchema.Types.Decimal128 }) promoPrice?: unknown;
  @Prop({ type: MongooseSchema.Types.Decimal128 }) costPrice?: unknown;
  @Prop({ default: 'MGA' }) currency!: string;

  /** Fenêtre de la promotion flash — absente pour une simple remise permanente. */
  @Prop({ type: Date }) promoStartAt?: Date;
  @Prop({ type: Date }) promoEndAt?: Date;

  @Prop({ default: 0, min: 0 }) stock!: number;
  @Prop({ default: 0, min: 0 }) minStock!: number;

  @Prop({ type: [MediaSchema], default: [] }) media!: Media[];
  @Prop({ type: [VariantSchema], default: [] }) variants!: Variant[];

  @Prop({ type: String, enum: ['draft', 'published', 'archived'], default: 'draft' })
  status!: 'draft' | 'published' | 'archived';

  @Prop({ type: Object, default: { views: 0, sales: 0, rating: 0, reviewCount: 0 } })
  stats!: { views: number; sales: number; rating: number; reviewCount: number };

  /** Recopiée de la boutique : permet un `$geoNear` direct sur les produits. */
  @Prop({ type: GeoPointSchema }) location?: GeoPoint;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ProductDocument = HydratedDocument<Product>;
export const ProductSchema = SchemaFactory.createForClass(Product);

ProductSchema.index({ shopId: 1, status: 1 });
ProductSchema.index({ categoryPath: 1, status: 1 });
ProductSchema.index({ status: 1, 'stats.views': -1 });
ProductSchema.index({ barcode: 1 }, { sparse: true });
ProductSchema.index({ location: '2dsphere' });
ProductSchema.index(
  { name: 'text', description: 'text' },
  { weights: { name: 10, description: 2 }, default_language: 'french' },
);
// Tri du catalogue par date : sans cet index, `sort` s'exécute en mémoire,
// plafonné à 32 Mo, et échoue en production (§6.5).
ProductSchema.index({ status: 1, createdAt: -1 });
// Promotions flash : filtrer les fenêtres actives sans scan complet.
ProductSchema.index({ status: 1, promoEndAt: 1 });
