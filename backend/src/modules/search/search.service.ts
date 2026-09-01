import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import { Category, type CategoryDocument } from '../catalog/schemas/category.schema';

export interface GlobalSearchResult {
  products: unknown[];
  shops: unknown[];
  categories: unknown[];
}

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(Category.name) private readonly categories: Model<CategoryDocument>,
  ) {}

  /**
   * Recherche transverse — une seule barre de recherche interroge produits,
   * boutiques et catégories à la fois (§2). Les catégories, référentiel quasi
   * statique et minuscule (§catalog.service.ts), sont filtrées par expression
   * régulière plutôt qu'un index texte dédié : la collection ne le justifie pas.
   */
  async global(q: string, limit: number): Promise<GlobalSearchResult> {
    const query = q.trim();
    if (!query) return { products: [], shops: [], categories: [] };

    const [products, shops, categories] = await Promise.all([
      this.products
        .find({ status: 'published', isHidden: { $ne: true }, $text: { $search: query } })
        .select('name slug price promoPrice currency media shop shopId stats')
        .limit(limit)
        .lean(),
      this.shops
        .find({ status: 'approved', $text: { $search: query } })
        .select('name slug logo categoryName address stats')
        .limit(limit)
        .lean(),
      this.categories
        .find({ name: { $regex: query, $options: 'i' } })
        .select('name slug icon parentId')
        .limit(limit)
        .lean(),
    ]);

    return { products, shops, categories };
  }
}
