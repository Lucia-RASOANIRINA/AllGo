import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';

/** Plafond par collection et par appel — évite une réponse de plusieurs mégaoctets. */
const MAX_PER_COLLECTION = 500;

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /**
   * Delta de synchronisation — §9.5.
   *
   * `serverTime` est renvoyé pour que le client l'utilise comme `since` au
   * prochain appel : se fier à l'horloge du téléphone ferait perdre des
   * documents dès qu'elle dérive de quelques secondes.
   *
   * `truncated` signale une collection plafonnée : le client doit rappeler
   * immédiatement plutôt que de croire sa synchronisation terminée.
   *
   * `categories` (MySQL réelle) n'a pas de colonne `updated_at` — référentiel
   * quasi statique (§catalog.service.ts), renvoyé en entier à chaque appel
   * plutôt qu'un delta impossible à calculer sans cette colonne.
   */
  async changesSince(
    user: AuthenticatedUser,
    since?: Date,
    collections?: string[],
  ): Promise<Record<string, unknown>> {
    const serverTime = new Date();
    const wanted = new Set(collections ?? ['products', 'categories', 'orders']);
    const result: Record<string, unknown> = { serverTime, truncated: [] as string[] };
    const truncated: string[] = [];

    if (wanted.has('categories')) {
      const categories = await this.prisma.categories.findMany({ orderBy: { id: 'asc' } });
      result.categories = categories.map((c) => ({
        id: String(c.id),
        name: c.name,
        slug: c.slug,
        icon: c.icon ?? undefined,
        parentId: c.parent_id ? String(c.parent_id) : undefined,
      }));
    }

    if (wanted.has('products')) {
      const rows = await this.prisma.products.findMany({
        where: { status: 'published', ...(since ? { updated_at: { gt: since } } : {}) },
        orderBy: { updated_at: 'asc' },
        take: MAX_PER_COLLECTION,
        include: { shops: { select: { name: true, slug: true } }, product_images: true },
      });
      if (rows.length === MAX_PER_COLLECTION) truncated.push('products');
      result.products = rows.map((row) => ({
        id: row.id,
        shopId: String(row.shop_id),
        shop: row.shops ? { name: row.shops.name, slug: row.shops.slug } : undefined,
        name: row.name,
        slug: row.slug,
        price: row.price,
        promoPrice: row.promo_price ?? undefined,
        stock: row.stock ?? 0,
        status: row.status,
        media: row.product_images.map((img) => ({
          ...this.media.publicUrls(img.image_path),
          type: img.media_type,
          isMain: img.is_main ?? false,
        })),
        updatedAt: row.updated_at,
      }));
    }

    if (wanted.has('orders')) {
      const rows = await this.prisma.orders.findMany({
        where: { user_id: user.mysqlId, ...(since ? { updated_at: { gt: since } } : {}) },
        orderBy: { updated_at: 'asc' },
        take: MAX_PER_COLLECTION,
        include: { order_items: true },
      });
      if (rows.length === MAX_PER_COLLECTION) truncated.push('orders');
      result.orders = rows.map((o) => ({
        id: String(o.id),
        orderNumber: o.order_number,
        shopId: String(o.shop_id),
        status: o.status,
        payment: { method: o.payment_method, status: o.payment_status },
        items: o.order_items.map((item) => ({
          productId: String(item.product_id),
          variantId: item.variant_id ? String(item.variant_id) : undefined,
          quantity: item.quantity,
          unitPrice: item.unit_price,
        })),
        total: o.total_amount,
        createdAt: o.created_at,
        updatedAt: o.updated_at,
      }));
    }

    result.truncated = truncated;
    return result;
  }
}
