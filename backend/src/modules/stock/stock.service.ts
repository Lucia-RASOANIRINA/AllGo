import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { StockMovement, type StockMovementDocument } from './schemas/stock-movement.schema';

export interface MoveStockInput {
  shopId: string;
  productId: string;
  type: 'in' | 'out' | 'correction';
  quantity: number;
  reason: string;
  note?: string;
  userId: string;
}

@Injectable()
export class StockService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
  ) {}

  /**
   * Mouvement de stock unitaire, typiquement déclenché par un scan.
   *
   * **Jamais autorisé hors ligne** (§9.3) : le stock est une source de vérité
   * partagée entre plusieurs employés. Deux magasiniers travaillant hors ligne
   * sur le même produit produiraient deux états divergents impossibles à
   * réconcilier honnêtement.
   *
   * Le produit et le mouvement évoluent dans la même transaction : un stock
   * modifié sans trace, ou une trace sans stock modifié, sont l'un comme
   * l'autre inexploitables pour un inventaire.
   */
  async move(input: MoveStockInput): Promise<{ stockAfter: number }> {
    const session = await this.connection.startSession();
    try {
      let stockAfter = 0;

      await session.withTransaction(async () => {
        const product = await this.products.findById(input.productId).session(session);
        if (!product) throw AppError.notFound('Produit');
        if (String(product.shopId) !== input.shopId) {
          throw new AppError(
            'PRODUCT_NOT_IN_SHOP',
            'Ce produit n’appartient pas à cette boutique.',
            403,
          );
        }

        const stockBefore = product.stock;
        const delta =
          input.type === 'in'
            ? input.quantity
            : input.type === 'out'
              ? -input.quantity
              : input.quantity - stockBefore; // correction : valeur absolue visée

        if (stockBefore + delta < 0) {
          throw AppError.insufficientStock(product.name, stockBefore, input.quantity);
        }

        stockAfter = stockBefore + delta;

        await this.products.updateOne(
          { _id: product._id },
          { $set: { stock: stockAfter } },
          { session },
        );

        await this.movements.create(
          [
            {
              at: new Date(),
              shopId: new Types.ObjectId(input.shopId),
              productId: product._id,
              type: input.type,
              reason: input.reason,
              quantity: Math.abs(delta),
              stockBefore,
              stockAfter,
              note: input.note,
              userId: new Types.ObjectId(input.userId),
            },
          ],
          { session },
        );
      });

      return { stockAfter };
    } finally {
      await session.endSession();
    }
  }

  /** Produits dont le stock est passé sous le seuil d'alerte. */
  async alerts(shopId: string): Promise<unknown[]> {
    return this.products
      .find({
        shopId: new Types.ObjectId(shopId),
        status: 'published',
        $expr: { $lte: ['$stock', '$minStock'] },
      })
      .select('name sku barcode stock minStock media')
      .sort({ stock: 1 })
      .lean();
  }
}
