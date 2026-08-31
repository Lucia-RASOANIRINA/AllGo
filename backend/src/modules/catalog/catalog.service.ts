import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { Category, type CategoryDocument } from './schemas/category.schema';
import { Product, type ProductDocument } from './schemas/product.schema';
import { ProductReview, type ProductReviewDocument } from './schemas/product-review.schema';

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
  sort?: 'new' | 'popular';
  onSale?: boolean;
  flashOnly?: boolean;
  minRating?: number;
  /** Exclut un produit précis — sert « produits similaires »/« recommandés »
   * pour ne jamais recommander le produit déjà consulté. */
  excludeId?: string;
}

/** Lit une valeur par chemin à points (`'stats.views'`) sur un document `lean()`. */
function getPath(doc: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object') return (value as Record<string, unknown>)[key];
    return undefined;
  }, doc);
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Category.name) private readonly categories: Model<CategoryDocument>,
    @InjectModel(ProductReview.name) private readonly productReviews: Model<ProductReviewDocument>,
  ) {}

  async listProducts(query: ProductQuery): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { status: 'published' };

    // `categoryPath` contient les ancêtres matérialisés : filtrer dessus
    // ramène la catégorie ET toutes ses sous-catégories, en une requête indexée.
    if (query.categoryId) filter.categoryPath = new Types.ObjectId(query.categoryId);
    if (query.shopId) filter.shopId = new Types.ObjectId(query.shopId);
    if (query.excludeId) filter._id = { $ne: new Types.ObjectId(query.excludeId) };
    if (query.q) filter.$text = { $search: query.q };
    if (query.inStock) filter.stock = { $gt: 0 };

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {
        ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
      };
    }

    if (query.onSale || query.flashOnly) filter.promoPrice = { $ne: null };
    if (query.flashOnly) filter.promoEndAt = { $gt: new Date() };
    if (query.minRating !== undefined) filter['stats.rating'] = { $gte: query.minRating };

    // Popularité = nombre de vues (`stats.views`), déjà indexé. Utilisé pour
    // des carrousels bornés (page d'accueil) : la pagination par curseur sur
    // ce champ n'a pas besoin d'être aussi éprouvée que le fil par défaut.
    const sortField = query.sort === 'popular' ? 'stats.views' : 'createdAt';

    if (query.cursor) {
      Object.assign(filter, cursorFilter(sortField, decodeCursor(query.cursor)));
    }

    const docs = await this.products
      .find(filter, this.projection(query.fields))
      .sort({ [sortField]: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean();

    const hasMore = docs.length > query.limit;
    const items = hasMore ? docs.slice(0, query.limit) : docs;
    const last = items[items.length - 1] as Record<string, unknown> | undefined;

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              value:
                sortField === 'createdAt'
                  ? (last.createdAt as Date).toISOString()
                  : ((getPath(last, sortField) as number) ?? 0),
              id: String(last._id),
            })
          : null,
    };
  }

  async findProduct(id: string): Promise<unknown> {
    // `$inc` sur le compteur de vues, sans relire ni réécrire le document entier.
    const product = await this.products.findOneAndUpdate(
      { _id: id, status: 'published' },
      { $inc: { 'stats.views': 1 } },
      { new: true },
    );
    if (!product) throw AppError.notFound('Produit');
    return product.toJSON();
  }

  /** Identification par scan de code-barres — fonction exclusivement mobile (§2.2). */
  async findByBarcode(barcode: string, shopId?: string): Promise<unknown> {
    const filter: Record<string, unknown> = { barcode };
    if (shopId) filter.shopId = new Types.ObjectId(shopId);

    const product = await this.products.findOne(filter).lean();
    if (!product) {
      throw new AppError(
        'BARCODE_NOT_FOUND',
        'Aucun produit ne correspond à ce code-barres.',
        404,
        { barcode },
      );
    }
    return product;
  }

  /**
   * Produits similaires/recommandés — définitions honnêtes, non personnalisées
   * (§ décisions de portée) : *similaires* = même catégorie, plus récents ;
   * *recommandés* = même catégorie, triés par popularité. Aucun moteur de
   * recommandation, réutilise `listProducts` telle quelle.
   */
  async relatedProducts(
    id: string,
    mode: 'similar' | 'recommended',
    limit: number,
  ): Promise<unknown[]> {
    const product = await this.products.findById(id).select('categoryId').lean();
    if (!product?.categoryId) return [];

    const page = await this.listProducts({
      limit,
      categoryId: String(product.categoryId),
      excludeId: id,
      sort: mode === 'similar' ? 'new' : 'popular',
    });
    return page.items;
  }

  /** Avis d'un produit, paginés par curseur — même motif que les avis boutique. */
  async listProductReviews(
    productId: string,
    limit: number,
    cursor?: string,
  ): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { productId: new Types.ObjectId(productId) };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const docs = await this.productReviews
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;
    const last = items[items.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: String(last._id) })
          : null,
    };
  }

  /**
   * Dépose ou remplace mon avis (upsert sur l'index unique
   * `{productId, userId}`) — un client ne peut avoir qu'un avis par produit.
   */
  async upsertProductReview(
    productId: string,
    userId: string,
    author: { name: string; avatar?: string },
    rating: number,
    comment: string | undefined,
  ): Promise<unknown> {
    const product = await this.products.findById(productId).select('_id').lean();
    if (!product) throw AppError.notFound('Produit');

    await this.productReviews.updateOne(
      { productId: new Types.ObjectId(productId), userId: new Types.ObjectId(userId) },
      { $set: { author, rating, comment, createdAt: new Date() } },
      { upsert: true },
    );
    await this.recomputeProductReviewStats(productId);

    return this.productReviews
      .findOne({ productId: new Types.ObjectId(productId), userId: new Types.ObjectId(userId) })
      .lean();
  }

  async removeOwnProductReview(productId: string, userId: string): Promise<void> {
    await this.productReviews.deleteOne({
      productId: new Types.ObjectId(productId),
      userId: new Types.ObjectId(userId),
    });
    await this.recomputeProductReviewStats(productId);
  }

  /**
   * Recalcule `stats.rating`/`stats.reviewCount` par agrégation complète —
   * même motif que `ShopsService.recomputeReviewStats`.
   */
  private async recomputeProductReviewStats(productId: string): Promise<void> {
    const [agg] = await this.productReviews.aggregate<{ avgRating: number; count: number }>([
      { $match: { productId: new Types.ObjectId(productId) } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    await this.products.updateOne(
      { _id: productId },
      {
        $set: {
          'stats.rating': agg ? Math.round(agg.avgRating * 10) / 10 : 0,
          'stats.reviewCount': agg?.count ?? 0,
        },
      },
    );
  }

  /**
   * Arborescence complète des catégories.
   * Renvoyée en une seule réponse, mise en cache 24 h côté client (§9.2) :
   * ce référentiel change quelques fois par an.
   */
  async categoryTree(): Promise<unknown[]> {
    const all = await this.categories.find().sort({ depth: 1, order: 1 }).lean();
    const byId = new Map(all.map((c) => [String(c._id), { ...c, children: [] as unknown[] }]));
    const roots: unknown[] = [];

    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(String(node.parentId)) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /**
   * Projection issue de `?fields=` — §7.1.
   * Sur un réseau 3G, ne pas transporter une description de 2 Ko dans une
   * grille de vignettes change réellement l'expérience.
   */
  private projection(fields?: string): Record<string, 1> | undefined {
    if (!fields) return undefined;
    const allowed = new Set([
      'name',
      'slug',
      'price',
      'promoPrice',
      'promoStartAt',
      'promoEndAt',
      'currency',
      'media',
      'stock',
      'shop',
      'shopId',
      'categoryId',
      'status',
      'stats',
      'barcode',
      'createdAt',
    ]);
    const projection: Record<string, 1> = { createdAt: 1 };
    for (const field of fields.split(',').map((f) => f.trim())) {
      if (allowed.has(field)) projection[field] = 1;
    }
    return projection;
  }
}
