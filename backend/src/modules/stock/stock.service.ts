import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { ShopsService } from '../shops/shops.service';
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
    @InjectModel(StockMovement.name) private readonly movements: Model<StockMovementDocument>,
    private readonly prisma: PrismaService,
    private readonly shopsService: ShopsService,
    private readonly media: MediaService,
  ) {}

  /**
   * Mouvement de stock unitaire, typiquement déclenché par un scan.
   *
   * **Jamais autorisé hors ligne** (§9.3) : le stock est une source de vérité
   * partagée entre plusieurs employés.
   */
  async move(input: MoveStockInput): Promise<{ stockAfter: number }> {
    const product = await this.prisma.products.findUnique({ where: { id: Number(input.productId) } });
    if (!product) throw AppError.notFound('Produit');
    if (String(product.shop_id) !== input.shopId) {
      throw new AppError('PRODUCT_NOT_IN_SHOP', 'Ce produit n’appartient pas à cette boutique.', 403);
    }

    const stockBefore = product.stock ?? 0;
    const delta =
      input.type === 'in'
        ? input.quantity
        : input.type === 'out'
          ? -input.quantity
          : input.quantity - stockBefore; // correction : valeur absolue visée

    if (stockBefore + delta < 0) {
      throw AppError.insufficientStock(product.name, stockBefore, input.quantity);
    }
    const stockAfter = stockBefore + delta;

    const updated = await this.prisma.products.updateMany({
      where: { id: product.id, stock: stockBefore },
      data: { stock: stockAfter },
    });
    if (updated.count === 0) {
      throw new AppError('STOCK_CONFLICT', 'Le stock a été modifié entre-temps. Réessayez.', 409);
    }

    const shopMirrorId = await this.shopsService.resolveMirrorId(Number(input.shopId));
    await this.movements.create({
      at: new Date(),
      shopId: new Types.ObjectId(shopMirrorId),
      productId: product.id,
      type: input.type,
      reason: input.reason,
      quantity: Math.abs(delta),
      stockBefore,
      stockAfter,
      note: input.note,
      userId: new Types.ObjectId(input.userId),
    });

    return { stockAfter };
  }

  /** Produits dont le stock est passé sous le seuil d'alerte. */
  async alerts(shopId: string): Promise<unknown[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: number; name: string; sku: string | null; barcode: string | null; stock: number | null; min_stock: number | null }>
    >`
      SELECT id, name, sku, barcode, stock, min_stock FROM products
      WHERE shop_id = ${Number(shopId)} AND status = 'published' AND stock <= min_stock
      ORDER BY stock ASC
    `;
    const images = await this.prisma.product_images.findMany({ where: { product_id: { in: rows.map((r) => r.id) } } });
    const imagesByProduct = new Map<number, typeof images>();
    for (const image of images) {
      const list = imagesByProduct.get(image.product_id) ?? [];
      list.push(image);
      imagesByProduct.set(image.product_id, list);
    }

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku ?? undefined,
      barcode: row.barcode ?? undefined,
      stock: row.stock ?? 0,
      minStock: row.min_stock ?? 0,
      media: (imagesByProduct.get(row.id) ?? []).map((img) => ({
        ...this.media.publicUrls(img.image_path),
        type: img.media_type,
        isMain: img.is_main ?? false,
      })),
    }));
  }

  /**
   * Historique des mouvements. La jointure vers les noms de produits se fait
   * en deux temps plutôt qu'un `$lookup` natif — `products` a migré vers
   * MySQL (Phase 2), un `$lookup` Mongo ne peut plus le joindre.
   */
  async history(shopId: string): Promise<unknown[]> {
    const shopMirrorId = await this.shopsService.resolveMirrorId(Number(shopId));
    const rows = await this.movements
      .find({ shopId: new Types.ObjectId(shopMirrorId) })
      .sort({ at: -1 })
      .limit(200)
      .lean();

    const productIds = [...new Set(rows.map((r) => r.productId))];
    const products = productIds.length
      ? await this.prisma.products.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    return rows.map((row) => ({ ...row, product: { name: nameById.get(row.productId) ?? 'Produit' } }));
  }
}
