import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { Category, type CategoryDocument } from './schemas/category.schema';
import { Product, type ProductDocument } from './schemas/product.schema';

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
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Category.name) private readonly categories: Model<CategoryDocument>,
  ) {}

  async listProducts(query: ProductQuery): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { status: 'published' };

    // `categoryPath` contient les ancêtres matérialisés : filtrer dessus
    // ramène la catégorie ET toutes ses sous-catégories, en une requête indexée.
    if (query.categoryId) filter.categoryPath = new Types.ObjectId(query.categoryId);
    if (query.shopId) filter.shopId = new Types.ObjectId(query.shopId);
    if (query.q) filter.$text = { $search: query.q };
    if (query.inStock) filter.stock = { $gt: 0 };

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filter.price = {
        ...(query.minPrice !== undefined ? { $gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { $lte: query.maxPrice } : {}),
      };
    }

    if (query.cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(query.cursor)));

    const docs = await this.products
      .find(filter, this.projection(query.fields))
      .sort({ createdAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean();

    const hasMore = docs.length > query.limit;
    const items = hasMore ? docs.slice(0, query.limit) : docs;
    const last = items[items.length - 1] as { _id: unknown; createdAt: Date } | undefined;

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: String(last._id) })
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
