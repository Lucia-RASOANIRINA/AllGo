import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';

export interface NearbyQuery {
  lng: number;
  lat: number;
  radiusKm: number;
  categoryId?: string;
  limit: number;
}

@Injectable()
export class GeoService {
  constructor(@InjectModel(Shop.name) private readonly shops: Model<ShopDocument>) {}

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

    return this.shops.aggregate([
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
          'stats.rating': 1,
          'stats.reviewCount': 1,
          'stats.productCount': 1,
          distanceM: { $round: ['$distanceM', 0] },
        },
      },
    ]);
  }
}
