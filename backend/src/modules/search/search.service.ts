import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';

export interface GlobalSearchResult {
  products: unknown[];
  shops: unknown[];
  categories: unknown[];
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /**
   * Recherche transverse — une seule barre de recherche interroge produits,
   * boutiques et catégories à la fois (§2). Les catégories, référentiel quasi
   * statique et minuscule (§catalog.service.ts), sont filtrées par
   * sous-chaîne plutôt qu'un index texte dédié : la table ne le justifie pas.
   */
  async global(q: string, limit: number): Promise<GlobalSearchResult> {
    const query = q.trim();
    if (!query) return { products: [], shops: [], categories: [] };

    const [products, shops, categories] = await Promise.all([
      this.prisma.products.findMany({
        where: {
          status: 'published',
          is_hidden: false,
          OR: [{ name: { contains: query } }, { description: { contains: query } }],
        },
        include: { shops: { select: { name: true, slug: true } }, product_images: true },
        take: limit,
      }),
      this.prisma.shops.findMany({
        where: {
          status: 'approved',
          OR: [{ name: { contains: query } }, { description: { contains: query } }],
        },
        take: limit,
      }),
      this.prisma.categories.findMany({ where: { name: { contains: query } }, take: limit }),
    ]);

    return {
      products: products.map((row) => ({
        id: row.id,
        shopId: String(row.shop_id),
        shop: row.shops ? { name: row.shops.name, slug: row.shops.slug } : undefined,
        name: row.name,
        slug: row.slug,
        price: row.price,
        promoPrice: row.promo_price ?? undefined,
        currency: 'MGA',
        media: row.product_images.map((img) => ({
          ...this.media.publicUrls(img.image_path),
          type: img.media_type,
          isMain: img.is_main ?? false,
        })),
      })),
      shops: shops.map((row) => ({
        id: String(row.id),
        name: row.name,
        slug: row.slug,
        logo: row.logo ?? undefined,
        address: { city: row.city ?? undefined },
      })),
      categories: categories.map((row) => ({
        id: String(row.id),
        name: row.name,
        slug: row.slug,
        icon: row.icon ?? undefined,
        parentId: row.parent_id ? String(row.parent_id) : undefined,
      })),
    };
  }
}
