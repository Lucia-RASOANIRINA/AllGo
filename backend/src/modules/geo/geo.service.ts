import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { closedNowFilter, openNowFilter, withOpenNow } from '../../common/time/open-now';

export interface NearbyQuery {
  lng: number;
  lat: number;
  radiusKm: number;
  categoryId?: string;
  openNow?: boolean;
  limit: number;
}

export interface NearbyProductQuery {
  lng: number;
  lat: number;
  radiusKm: number;
  categoryId?: string;
  limit: number;
}

@Injectable()
export class GeoService {
  constructor(
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
  ) {}

  /**
   * Recherche de boutiques par proximité — fonction « WiFiMarkets ».
   *
   * Le web calcule aujourd'hui la distance par une formule de Haversine écrite
   * à la main en SQL, sans index possible : chaque recherche parcourt
   * l'intégralité de la table des boutiques — environ 800 ms à 10 000 boutiques.
   *
   * `$geoNear` sur index `2dsphere` : indexé, trié par distance, correct sur
   * l'ellipsoïde terrestre, et les filtres sont appliqués DANS l'étape
   * géographique plutôt qu'après (annexe C). Cible : < 150 ms.
   *
   * `$geoNear` doit obligatoirement être le PREMIER étage du pipeline.
   */
  async nearbyShops(query: NearbyQuery): Promise<unknown[]> {
    const filter: Record<string, unknown> = { status: 'approved' };
    if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);
    if (query.openNow === true) Object.assign(filter, openNowFilter());
    if (query.openNow === false) Object.assign(filter, closedNowFilter());

    const shops = await this.shops.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [query.lng, query.lat] },
          distanceField: 'distanceM',
          maxDistance: query.radiusKm * 1000,
          spherical: true,
          query: filter,
        },
      },
      { $limit: query.limit },
      {
        // Projection restreinte : sur un forfait de données malgache, chaque
        // champ superflu se paie (§13.1 — < 1,5 Mo par session de 5 minutes).
        $project: {
          name: 1,
          slug: 1,
          logo: 1,
          categoryName: 1,
          'address.city': 1,
          location: 1,
          deliveryRadiusKm: 1,
          openingHours: 1,
          closedDays: 1,
          'stats.rating': 1,
          'stats.reviewCount': 1,
          'stats.productCount': 1,
          distanceM: { $round: ['$distanceM', 0] },
        },
      },
    ]);

    return shops.map(withOpenNow);
  }

  /**
   * Produits à proximité — même mécanique que `nearbyShops`, sur la
   * localisation recopiée depuis la boutique (§ schéma produit). Un produit
   * dont la boutique n'a pas encore de position déclarée n'a pas de champ
   * `location` : il ne peut logiquement pas apparaître ici.
   */
  async nearbyProducts(query: NearbyProductQuery): Promise<unknown[]> {
    const filter: Record<string, unknown> = {
      status: 'published',
      isHidden: { $ne: true },
      isAvailable: { $ne: false },
    };
    if (query.categoryId) filter.categoryPath = new Types.ObjectId(query.categoryId);

    return this.products.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [query.lng, query.lat] },
          distanceField: 'distanceM',
          maxDistance: query.radiusKm * 1000,
          spherical: true,
          query: filter,
        },
      },
      { $limit: query.limit },
      {
        $project: {
          name: 1,
          slug: 1,
          price: 1,
          promoPrice: 1,
          currency: 1,
          media: 1,
          stock: 1,
          shopId: 1,
          shop: 1,
          'stats.rating': 1,
          'stats.reviewCount': 1,
          distanceM: { $round: ['$distanceM', 0] },
        },
      },
    ]);
  }
}
