import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * Arborescence de catégories par **ancêtres matérialisés**.
 *
 * `ancestors` porte la chaîne complète depuis la racine : une sous-arborescence
 * entière se récupère par `{ ancestors: id }`, en une seule requête indexée.
 */
@Schema({ collection: 'categories', timestamps: true })
export class Category extends Document {
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ required: true, lowercase: true }) slug!: string;
  @Prop() icon?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Category', default: null })
  parentId!: Types.ObjectId | null;

  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] }) ancestors!: Types.ObjectId[];
  @Prop({ default: 0 }) depth!: number;
  @Prop({ default: 0 }) order!: number;
  @Prop({ default: 0 }) productCount!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type CategoryDocument = HydratedDocument<Category>;
export const CategorySchema = SchemaFactory.createForClass(Category);

CategorySchema.index({ slug: 1 }, { unique: true });
CategorySchema.index({ parentId: 1, order: 1 });
CategorySchema.index({ ancestors: 1 });
