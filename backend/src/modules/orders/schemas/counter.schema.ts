import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Séquence atomique — alimente `orders.orderNumber` et les numéros de facture.
 *
 * `findOneAndUpdate` avec `$inc` et `upsert` est atomique même sous forte
 * concurrence : deux commandes simultanées ne peuvent pas recevoir le même
 * numéro. C'est ce qui remplace `uniqid()` côté web.
 */
@Schema({ collection: 'counters', versionKey: false, _id: false })
export class Counter {
  /** Clé de séquence, par exemple `order:2026` ou `invoice:2026`. */
  @Prop({ type: String, required: true }) _id!: string;

  @Prop({ type: Number, default: 0 }) seq!: number;
}

export type CounterDocument = HydratedDocument<Counter>;
export const CounterSchema = SchemaFactory.createForClass(Counter);
