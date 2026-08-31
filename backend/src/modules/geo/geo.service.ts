import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { closedNowFilter, openNowFilter } from '../../common/time/open-now';
import type { GeoPoint } from '../users/schemas/user.schema';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';

export interface NearbyQuery {
  lng: number;
  lat: number;
  radiusKm: number;
  categoryId?: string;
  openNow?: boolean;
  closedNow?: boolean;
  limit: number;
}

/** Rayon moyen terrestre en mètres, pour la formule de Haversine. */
const EARTH_RADIUS_M = 6_371_000;

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
    if (query.openNow) Object.assign(filter, openNowFilter());
    else if (query.closedNow) Object.assign(filter, closedNowFilter());

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

  /**
   * Recherche de produits par proximité, sur la position dénormalisée du
   * produit (recopiée de sa boutique — voir `Product.location`). Même
   * pipeline que `nearbyShops` : `$geoNear` en premier, projection restreinte.
   */
  async nearbyProducts(query: NearbyQuery): Promise<unknown[]> {
    const filter: Record<string, unknown> = { status: 'published' };
    if (query.categoryId) filter.categoryId = new Types.ObjectId(query.categoryId);

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
          media: { $slice: ['$media', 1] },
          shopId: 1,
          'shop.name': 1,
          location: 1,
          distanceM: { $round: ['$distanceM', 0] },
        },
      },
    ]);
  }

  /** Exposé pour l'estimation de repli quand la destination n'a pas pu être
   * géolocalisée (`CartService.preview`) — le forfait sans le kilométrage. */
  readonly baseDeliveryFee = 1000;
  private readonly perKmRate = 500;

  /**
   * Frais de livraison — forfait + tarif au kilomètre, sur la distance à vol
   * d'oiseau entre la boutique et l'adresse de livraison (§ décisions de
   * portée : pas de tarification par zone, pas de temps de trajet réel).
   *
   * Calcul point-à-point, PAS `$geoNear` : `$geoNear` sert à trouver ce qui
   * est proche d'un point dans une collection, pas à mesurer la distance
   * entre deux points déjà connus — aucun index n'entre en jeu ici.
   */
  computeDeliveryFee(
    shopLocation: GeoPoint,
    destination: GeoPoint,
  ): { distanceKm: number; fee: number } {
    const distanceKm = GeoService.haversineKm(shopLocation, destination);
    const rawFee = this.baseDeliveryFee + Math.ceil(distanceKm) * this.perKmRate;
    // Arrondi à la centaine d'Ariary la plus proche : un montant comme
    // 1 847 Ar n'a pas de petite monnaie correspondante à Mahajanga.
    const fee = Math.ceil(rawFee / 100) * 100;

    return { distanceKm, fee };
  }

  /** ATTENTION : `coordinates` est en GeoJSON, donc [longitude, latitude]. */
  private static haversineKm(a: GeoPoint, b: GeoPoint): number {
    const [lngA, latA] = a.coordinates;
    const [lngB, latB] = b.coordinates;

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(latB - latA);
    const dLng = toRad(lngB - lngA);

    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * sinLng * sinLng;

    return (2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))) / 1000;
  }
}
