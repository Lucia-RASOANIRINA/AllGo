import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

@Schema({ _id: true })
export class CartItem {
  /**
   * Identifiant entier MySQL (`products.id`) — pas un ObjectId Mongo depuis la
   * migration du Catalogue (§ décision du 2026-09-09, Phase 2).
   */
  @Prop({ type: Number, required: true }) productId!: number;
  @Prop({ type: Number }) variantId?: number;
  @Prop({ required: true, min: 1 }) quantity!: number;
  @Prop({ type: Date, default: () => new Date() }) addedAt!: Date;

  /**
   * Instantané d'affichage : le panier se rend hors ligne, sans jointure.
   * Attention — il n'a AUCUNE valeur contractuelle. Le prix facturé est
   * toujours relu depuis `products` au moment de la création de la commande.
   */
  @Prop({ type: Object, required: true })
  snapshot!: {
    name: string;
    image?: string;
    price: unknown;
    /** Identifiant entier MySQL (`shops.id`). */
    shopId: number;
    shopName: string;
  };
}
export const CartItemSchema = SchemaFactory.createForClass(CartItem);

/**
 * Un document par utilisateur, `_id` = identifiant utilisateur.
 * Lecture et écriture du panier en une seule opération (§6.2).
 */
@Schema({ collection: 'carts', timestamps: true, _id: false })
export class Cart {
  /** Identifiant utilisateur, servant directement de clé primaire. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true }) _id!: Types.ObjectId;
  @Prop({ type: [CartItemSchema], default: [] }) items!: CartItem[];
  updatedAt!: Date;
}

export type CartDocument = HydratedDocument<Cart>;
export const CartSchema = SchemaFactory.createForClass(Cart);
