import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';

export interface MoveStockInput {
  shopId: string;
  productId: string;
  type: 'in' | 'out' | 'correction';
  quantity: number;
  reason: string;
  note?: string;
  userId: number;
}

/**
 * `stock_movements` (table MySQL réelle depuis la Phase 6) — remplace la
 * collection Mongo `stockMovements`. L'ADR qui la maintenait sur Mongo
 * (incompatibilité time-series/transaction) est levée par décision explicite
 * du 2026-09-10 : `shop_id`/`user_id` sont désormais des entiers MySQL
 * directs, ce qui a aussi permis de retirer le miroir Mongo `Shop`.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
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

    await this.prisma.stock_movements.create({
      data: {
        shop_id: Number(input.shopId),
        product_id: product.id,
        user_id: input.userId,
        type: input.type,
        reason: input.reason,
        quantity: Math.abs(delta),
        stock_before: stockBefore,
        stock_after: stockAfter,
        note: input.note,
      },
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

  /** Historique des mouvements, du plus récent au plus ancien. */
  async history(shopId: string): Promise<unknown[]> {
    const rows = await this.prisma.stock_movements.findMany({
      where: { shop_id: Number(shopId) },
      orderBy: { at: 'desc' },
      take: 200,
      include: { products: { select: { name: true } } },
    });

    return rows.map((row) => ({
      id: String(row.id),
      shopId: String(row.shop_id),
      productId: String(row.product_id),
      userId: String(row.user_id),
      type: row.type,
      reason: row.reason,
      quantity: row.quantity,
      stockBefore: row.stock_before,
      stockAfter: row.stock_after,
      unitCost: row.unit_cost ? Number(row.unit_cost) : undefined,
      supplier: row.supplier ?? undefined,
      note: row.note ?? undefined,
      at: row.at,
      product: { name: row.products.name },
    }));
  }
}
