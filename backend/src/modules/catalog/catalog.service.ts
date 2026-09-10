import { Injectable } from '@nestjs/common';
import type { Prisma, products } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { decodeCursor, encodeCursor, prismaCursorFilter } from '../../common/pagination/cursor';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import type { CreateProductDto, UpdateProductDto } from './dto/product.dto';

const PRODUCT_INCLUDE = {
  shops: { select: { name: true, slug: true } },
  product_images: true,
  product_variants: true,
} satisfies Prisma.productsInclude;

type ProductWithRelations = products & {
  shops: { name: string; slug: string } | null;
  product_images: { id: number; image_path: string; media_type: string; is_main: boolean | null }[];
  product_variants: { id: number; name: string; value: string; extra_price: unknown; stock: number | null }[];
};

export interface ProductQuery {
  limit: number;
  cursor?: string;
  fields?: string;
  categoryId?: string;
  shopId?: string;
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  /** Vitrine de l'accueil (§7.1) : sans effet si `cursor` est fourni — un rail n'est jamais paginé. */
  sort?: 'newest' | 'popular';
  onSale?: boolean;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /**
   * Catégorie + tous ses descendants — CTE récursive.
   *
   * Remplace `Product.categoryPath` (Mongo), qui en pratique n'était JAMAIS
   * peuplé par le code applicatif (seul le jeu de données de départ le
   * renseignait) : les recherches par catégorie profonde étaient donc
   * silencieusement dégradées depuis longtemps. La table `categories` réelle
   * est une simple liste d'adjacence (`parent_id`) — petite et rarement
   * modifiée, une CTE calculée à la volée est plus simple à maintenir qu'un
   * chemin matérialisé à resynchroniser à chaque déplacement de catégorie.
   */
  private async descendantCategoryIds(categoryId: number): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<{ id: number }[]>`
      WITH RECURSIVE descendants AS (
        SELECT id FROM categories WHERE id = ${categoryId}
        UNION ALL
        SELECT c.id FROM categories c INNER JOIN descendants d ON c.parent_id = d.id
      )
      SELECT id FROM descendants
    `;
    return rows.map((r) => r.id);
  }

  async listProducts(query: ProductQuery): Promise<Paginated<unknown>> {
    const where: Prisma.productsWhereInput = {
      status: 'published',
      is_hidden: false,
      is_available: true,
    };

    if (query.categoryId) {
      where.category_id = { in: await this.descendantCategoryIds(Number(query.categoryId)) };
    }
    if (query.shopId) where.shop_id = Number(query.shopId);
    if (query.q) {
      const q = query.q.trim();
      // `utf8mb4_general_ci` (collation par défaut MariaDB) est déjà
      // insensible à la casse : pas besoin d'échapper/insensibiliser comme
      // pour le regex Mongo qu'on remplace ici.
      where.OR = [{ name: { contains: q } }, { description: { contains: q } }];
    }
    if (query.inStock) where.stock = { gt: 0 };
    if (query.onSale) where.promo_price = { not: null };
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.price = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
    }

    // Un rail de vitrine (accueil) n'est jamais paginé : le tri par
    // popularité n'a de sens que sur un aperçu borné, jamais sur un curseur.
    const orderBy: Prisma.productsOrderByWithRelationInput[] =
      query.sort === 'popular' && !query.cursor
        ? [{ views: 'desc' }, { id: 'desc' }]
        : [{ created_at: 'desc' }, { id: 'desc' }];

    if (query.cursor) {
      Object.assign(where, prismaCursorFilter('created_at', decodeCursor(query.cursor)));
    }

    const rows = await this.prisma.products.findMany({
      where,
      include: PRODUCT_INCLUDE,
      orderBy,
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items[items.length - 1] as ProductWithRelations | undefined;

    return {
      items: items.map((row) => this.toJson(row as ProductWithRelations, query.fields)),
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.created_at!.toISOString(), id: String(last.id) })
          : null,
    };
  }

  async listShopProducts(shopId: string): Promise<unknown[]> {
    const rows = await this.prisma.products.findMany({
      where: { shop_id: Number(shopId) },
      include: PRODUCT_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
    return rows.map((row) => this.toJson(row as ProductWithRelations));
  }

  async createProduct(shopId: string, dto: CreateProductDto): Promise<unknown> {
    const shop = await this.prisma.shops.findUnique({ where: { id: Number(shopId) } });
    if (!shop) throw AppError.notFound('Boutique');

    const created = await this.prisma.products.create({
      data: {
        shop_id: Number(shopId),
        category_id: dto.categoryId ? Number(dto.categoryId) : undefined,
        name: dto.name,
        slug: dto.slug,
        sku: dto.sku,
        barcode: dto.barcode,
        description: dto.description,
        price: dto.price,
        promo_price: dto.promoPrice,
        stock: dto.stock ?? 0,
        min_stock: dto.minStock ?? 0,
        status: dto.isHidden ? 'draft' : 'published',
        is_available: dto.isAvailable ?? true,
        is_featured: dto.isFeatured ?? false,
        is_hidden: dto.isHidden ?? false,
        product_images: { create: this.buildImageRows(dto) },
        product_variants: { create: this.buildVariantRows(dto) },
      },
      include: PRODUCT_INCLUDE,
    });
    return this.toJson(created as ProductWithRelations);
  }

  async updateProduct(shopId: string, id: string, dto: UpdateProductDto): Promise<unknown> {
    const existing = await this.prisma.products.findFirst({
      where: { id: Number(id), shop_id: Number(shopId) },
    });
    if (!existing) throw AppError.notFound('Produit');

    const imageRows = this.buildImageRows(dto);
    const variantRows = this.buildVariantRows(dto);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Remplacement complet des images/variantes fournies — même contrat que
      // l'ancien `$set` sur un tableau Mongo (listes courtes, pas de diff
      // ligne à ligne nécessaire).
      if (dto.media !== undefined || dto.mediaKey) {
        await tx.product_images.deleteMany({ where: { product_id: existing.id } });
      }
      if (dto.variants !== undefined) {
        await tx.product_variants.deleteMany({ where: { product_id: existing.id } });
      }
      return tx.products.update({
        where: { id: existing.id },
        data: {
          category_id: dto.categoryId !== undefined ? Number(dto.categoryId) : undefined,
          name: dto.name,
          slug: dto.slug,
          sku: dto.sku,
          barcode: dto.barcode,
          description: dto.description,
          price: dto.price,
          promo_price: dto.promoPrice,
          stock: dto.stock,
          min_stock: dto.minStock,
          ...(dto.isHidden !== undefined ? { status: dto.isHidden ? 'draft' : 'published' } : {}),
          is_available: dto.isAvailable,
          is_featured: dto.isFeatured,
          is_hidden: dto.isHidden,
          ...((dto.media !== undefined || dto.mediaKey) && imageRows.length
            ? { product_images: { create: imageRows } }
            : {}),
          ...(dto.variants !== undefined && variantRows.length
            ? { product_variants: { create: variantRows } }
            : {}),
        },
        include: PRODUCT_INCLUDE,
      });
    });

    return this.toJson(updated as ProductWithRelations);
  }

  async deleteProduct(shopId: string, id: string): Promise<{ deleted: true }> {
    const result = await this.prisma.products.deleteMany({
      where: { id: Number(id), shop_id: Number(shopId) },
    });
    if (!result.count) throw AppError.notFound('Produit');
    return { deleted: true };
  }

  /**
   * Importation en masse (§18) — le commerçant crée à la main via l'interface
   * de saisie, produit par produit ; cet appel permet de charger un catalogue
   * entier en une fois (typiquement depuis un fichier préparé côté client).
   */
  async importProducts(
    shopId: string,
    items: CreateProductDto[],
  ): Promise<{ created: number; errors: Array<{ index: number; message: string }> }> {
    const shop = await this.prisma.shops.findUnique({ where: { id: Number(shopId) } });
    if (!shop) throw AppError.notFound('Boutique');

    let created = 0;
    const errors: Array<{ index: number; message: string }> = [];

    for (let index = 0; index < items.length; index += 1) {
      const dto = items[index];
      try {
        await this.createProduct(shopId, dto);
        created += 1;
      } catch (error) {
        const message =
          error instanceof Error && error.message.includes('Unique constraint')
            ? `Un produit porte déjà l'identifiant « ${dto.slug} ».`
            : error instanceof Error
              ? error.message
              : 'Erreur inconnue.';
        errors.push({ index, message });
      }
    }

    return { created, errors };
  }

  /**
   * Produits similaires (§5) — même catégorie d'abord, complétée par
   * d'autres produits de la même boutique si la catégorie n'en fournit pas
   * assez. Pas de moteur de recommandation : un héritage direct de la
   * catégorie, qui reste vérifiable et n'exige aucun historique utilisateur.
   */
  async similarProducts(productId: string, limit: number): Promise<unknown[]> {
    const product = await this.prisma.products.findUnique({
      where: { id: Number(productId) },
      select: { id: true, category_id: true, shop_id: true },
    });
    if (!product) throw AppError.notFound('Produit');

    const baseWhere: Prisma.productsWhereInput = { status: 'published', is_hidden: false };
    const categoryWhere: Prisma.productsWhereInput = { ...baseWhere, id: { not: product.id } };
    if (product.category_id) {
      categoryWhere.category_id = { in: await this.descendantCategoryIds(product.category_id) };
    } else {
      categoryWhere.shop_id = product.shop_id;
    }

    const sameCategory = await this.prisma.products.findMany({
      where: categoryWhere,
      include: PRODUCT_INCLUDE,
      orderBy: { views: 'desc' },
      take: limit,
    });

    if (sameCategory.length >= limit) return sameCategory.map((r) => this.toJson(r as ProductWithRelations));

    // La catégorie n'a pas fourni assez de résultats : on complète avec
    // d'autres produits de la même boutique plutôt que de renvoyer une
    // liste tronquée sans raison apparente pour le client.
    const excludeIds = [product.id, ...sameCategory.map((p) => p.id)];
    const fromShop = await this.prisma.products.findMany({
      where: { ...baseWhere, id: { notIn: excludeIds }, shop_id: product.shop_id },
      include: PRODUCT_INCLUDE,
      take: limit - sameCategory.length,
    });

    return [...sameCategory, ...fromShop].map((r) => this.toJson(r as ProductWithRelations));
  }

  async duplicateProduct(shopId: string, id: string): Promise<unknown> {
    const source = await this.prisma.products.findFirst({
      where: { id: Number(id), shop_id: Number(shopId) },
      include: PRODUCT_INCLUDE,
    });
    if (!source) throw AppError.notFound('Produit');

    const created = await this.prisma.products.create({
      data: {
        shop_id: source.shop_id,
        category_id: source.category_id,
        name: `${source.name} (copie)`,
        slug: `${source.slug}-copie-${Date.now()}`,
        sku: source.sku ? `${source.sku}-COPY-${Date.now()}` : undefined,
        barcode: undefined,
        description: source.description,
        price: source.price,
        promo_price: source.promo_price,
        stock: source.stock,
        min_stock: source.min_stock,
        status: 'draft',
        is_available: source.is_available,
        is_featured: false,
        is_hidden: true,
        product_images: {
          create: source.product_images.map((img) => ({
            image_path: img.image_path,
            media_type: img.media_type,
            is_main: img.is_main,
          })),
        },
        product_variants: {
          create: source.product_variants.map((v) => ({
            name: v.name,
            value: v.value,
            extra_price: v.extra_price,
            stock: v.stock,
          })),
        },
      },
      include: PRODUCT_INCLUDE,
    });
    return this.toJson(created as ProductWithRelations);
  }

  async findProduct(id: string): Promise<unknown> {
    const numericId = Number(id);
    const result = await this.prisma.products.updateMany({
      where: { id: numericId, status: 'published' },
      data: { views: { increment: 1 } },
    });
    if (!result.count) throw AppError.notFound('Produit');

    const product = await this.prisma.products.findUnique({
      where: { id: numericId },
      include: PRODUCT_INCLUDE,
    });
    return this.toJson(product as ProductWithRelations);
  }

  /** Identification par scan de code-barres — fonction exclusivement mobile (§2.2). */
  async findByBarcode(barcode: string, shopId?: string): Promise<unknown> {
    const product = await this.prisma.products.findFirst({
      where: { barcode, ...(shopId ? { shop_id: Number(shopId) } : {}) },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new AppError('BARCODE_NOT_FOUND', 'Aucun produit ne correspond à ce code-barres.', 404, {
        barcode,
      });
    }
    return this.toJson(product as ProductWithRelations);
  }

  /**
   * Arborescence complète des catégories.
   * Renvoyée en une seule réponse, mise en cache 24 h côté client (§9.2) :
   * ce référentiel change quelques fois par an.
   */
  async categoryTree(): Promise<unknown[]> {
    const all = await this.prisma.categories.findMany({ orderBy: { id: 'asc' } });
    const byId = new Map(
      all.map((c) => [
        c.id,
        { id: String(c.id), name: c.name, slug: c.slug, icon: c.icon ?? undefined, children: [] as unknown[] },
      ]),
    );
    const roots: unknown[] = [];

    for (const category of all) {
      const node = byId.get(category.id)!;
      const parent = category.parent_id ? byId.get(category.parent_id) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** `mediaKey` (photo unique) prioritaire sur `media` — même convention que le logo boutique. */
  private buildImageRows(
    dto: Pick<CreateProductDto, 'mediaKey' | 'media'>,
  ): Prisma.product_imagesCreateWithoutProductsInput[] {
    if (dto.mediaKey) {
      return [{ image_path: dto.mediaKey, media_type: 'image', is_main: true }];
    }
    return (dto.media ?? []).map((m, index) => ({
      image_path: m.url,
      media_type: m.type === 'video' ? 'video' : 'image',
      is_main: m.isMain ?? index === 0,
    }));
  }

  private buildVariantRows(
    dto: Pick<CreateProductDto, 'variants'>,
  ): Prisma.product_variantsCreateWithoutProductsInput[] {
    return (dto.variants ?? []).map((v) => ({
      name: v.name,
      value: [v.size, v.color].filter(Boolean).join(' / ') || v.name,
      extra_price: v.priceDelta ?? 0,
      stock: v.stock ?? 0,
    }));
  }

  /**
   * Projection issue de `?fields=` — §7.1.
   * Sur un réseau 3G, ne pas transporter une description de 2 Ko dans une
   * grille de vignettes change réellement l'expérience.
   */
  private toJson(row: ProductWithRelations, fields?: string): unknown {
    const full = {
      id: row.id,
      shopId: String(row.shop_id),
      shop: row.shops ? { name: row.shops.name, slug: row.shops.slug } : undefined,
      categoryId: row.category_id ? String(row.category_id) : undefined,
      name: row.name,
      slug: row.slug,
      sku: row.sku ?? undefined,
      barcode: row.barcode ?? undefined,
      description: row.description ?? undefined,
      price: row.price,
      promoPrice: row.promo_price ?? undefined,
      currency: 'MGA',
      stock: row.stock ?? 0,
      minStock: row.min_stock ?? 0,
      status: row.status,
      isAvailable: row.is_available,
      isFeatured: row.is_featured,
      isHidden: row.is_hidden,
      media: row.product_images.map((img) => ({
        ...this.media.publicUrls(img.image_path),
        type: img.media_type,
        isMain: img.is_main ?? false,
      })),
      variants: row.product_variants.map((v) => ({
        id: String(v.id),
        name: v.name,
        value: v.value,
        priceDelta: v.extra_price,
        stock: v.stock ?? 0,
      })),
      stats: { views: row.views ?? 0 },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    if (!fields) return full;
    const allowed = new Set(fields.split(',').map((f) => f.trim()));
    const projected: Record<string, unknown> = { id: full.id, createdAt: full.createdAt };
    for (const [key, value] of Object.entries(full)) {
      if (allowed.has(key)) projected[key] = value;
    }
    return projected;
  }
}
