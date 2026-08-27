import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * Mouvements de stock — journal d'inventaire append-only.
 *
 * ─── Écart assumé par rapport au §6.2 — voir ADR 0002 ───────────────────────
 *
 * Le cahier des charges prescrit une **collection de séries temporelles**
 * (§6.2) et, dans le même document, une **transaction multi-documents**
 * englobant `orders`, `products.stock` et `stockMovements` (§6.3).
 *
 * MongoDB interdit la conjonction des deux :
 *
 *     Cannot insert into a time-series collection in a multi-document
 *     transaction: allgo.stockMovements
 *
 * Les deux exigences ne peuvent pas être satisfaites simultanément. Écrire le
 * mouvement hors transaction laisserait le journal d'inventaire trouable — un
 * stock décrémenté sans trace — ce qui ruine le contrôle de cohérence du §15.5.
 * L'intégrité prime sur la compression : la collection redevient ordinaire.
 *
 * Ce qui est conservé du modèle « série temporelle » :
 *   - la forme du document est inchangée, champ temporel `at` compris ;
 *   - l'index `{ shopId, at }` sert les mêmes lectures chronologiques ;
 *   - la règle **append-only** demeure, appliquée par le service : une
 *     correction s'enregistre comme un nouveau mouvement de type `correction`,
 *     jamais comme une réécriture. Le journal d'audit reste inviolable.
 *
 * Ce qui est perdu : la compression native (de l'ordre de 3 à 5× sur ce type
 * de données). À revoir au lot L6, lorsque le volume réel sera mesuré : un
 * archivage périodique vers une collection de séries temporelles séparée, hors
 * du chemin transactionnel, récupérerait le gain sans le risque.
 */
@Schema({
  collection: 'stockMovements',
  versionKey: false,
  timestamps: false,
})
export class StockMovement extends Document {
  @Prop({ type: Date, default: () => new Date(), required: true }) at!: Date;

  @Prop({ type: Types.ObjectId, ref: 'Shop', required: true }) shopId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true }) productId!: Types.ObjectId;

  @Prop({ type: String, enum: ['in', 'out', 'correction'], required: true })
  type!: 'in' | 'out' | 'correction';

  @Prop({ required: true }) reason!: string;
  @Prop({ required: true }) quantity!: number;
  @Prop({ required: true }) stockBefore!: number;
  @Prop({ required: true }) stockAfter!: number;

  @Prop({ type: MongooseSchema.Types.Decimal128 }) unitCost?: unknown;
  @Prop() supplier?: string;
  @Prop() note?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true }) userId!: Types.ObjectId;
}

export type StockMovementDocument = HydratedDocument<StockMovement>;
export const StockMovementSchema = SchemaFactory.createForClass(StockMovement);

// Lecture chronologique par boutique — l'accès dominant : « historique des
// mouvements de ma boutique, du plus récent au plus ancien ».
StockMovementSchema.index({ shopId: 1, at: -1 });

// Reconstitution du parcours d'un produit, pour un inventaire ou un litige.
StockMovementSchema.index({ productId: 1, at: -1 });
