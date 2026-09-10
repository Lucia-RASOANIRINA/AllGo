import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { isShopOpenNow, type OpeningHourRow } from '../../common/time/open-now';

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

interface NearbyShopRow {
  id: number;
  name: string;
  slug: string;
  logo: string | null;
  category_id: number | null;
  city: string | null;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  delivery_radius_km: Prisma.Decimal | null;
  distance_m: number;
}

interface NearbyProductRow {
  id: number;
  name: string;
  slug: string;
  price: Prisma.Decimal;
  promo_price: Prisma.Decimal | null;
  stock: number | null;
  shop_id: number;
  shop_name: string;
  shop_slug: string;
  distance_m: number;
}

/**
 * Recherche de boutiques/produits par proximité — fonction « autour de moi ».
 *
 * Le web calcule la distance par une formule de Haversine écrite à la main en
 * SQL, sans index possible : chaque recherche parcourt l'intégralité de la
 * table. Ici, `ST_Distance_Sphere` (natif MariaDB 11.4) fait le même calcul
 * correctement sur l'ellipsoïde, avec un pré-filtre par boîte englobante pour
 * éviter de calculer la distance exacte sur des lignes hors de propos — sans
 * aucune colonne spatiale ni index à ajouter (§ Phase 2, échelle actuelle
 * trop faible pour le justifier).
 */
@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /** Boîte englobante en degrés pour un rayon donné (pré-filtre, avant le calcul exact). */
  private static boundingBox(lat: number, lng: number, radiusKm: number) {
    const latDelta = radiusKm / 111.045;
    const lngDelta = radiusKm / (111.045 * Math.cos((lat * Math.PI) / 180));
    return {
      minLat: lat - latDelta,
      maxLat: lat + latDelta,
      minLng: lng - lngDelta,
      maxLng: lng + lngDelta,
    };
  }

  async nearbyShops(query: NearbyQuery): Promise<unknown[]> {
    const { minLat, maxLat, minLng, maxLng } = GeoService.boundingBox(query.lat, query.lng, query.radiusKm);
    const radiusM = query.radiusKm * 1000;

    const rows = await this.prisma.$queryRaw<NearbyShopRow[]>`
      SELECT s.id, s.name, s.slug, s.logo, s.category_id, s.city,
             s.latitude, s.longitude, s.delivery_radius_km,
             ST_Distance_Sphere(POINT(s.longitude, s.latitude), POINT(${query.lng}, ${query.lat})) AS distance_m
      FROM shops s
      WHERE s.status = 'approved'
        AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
        AND s.latitude BETWEEN ${minLat} AND ${maxLat}
        AND s.longitude BETWEEN ${minLng} AND ${maxLng}
        AND ST_Distance_Sphere(POINT(s.longitude, s.latitude), POINT(${query.lng}, ${query.lat})) <= ${radiusM}
        ${query.categoryId ? Prisma.sql`AND s.category_id = ${Number(query.categoryId)}` : Prisma.empty}
      ORDER BY distance_m
      LIMIT ${query.limit}
    `;

    if (rows.length === 0) return [];

    const hoursByShop = await this.openingHoursByShop(rows.map((r) => r.id));

    const withOpen = rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      slug: row.slug,
      logo: row.logo ?? undefined,
      categoryId: row.category_id ? String(row.category_id) : undefined,
      city: row.city ?? undefined,
      location: { type: 'Point' as const, coordinates: [Number(row.longitude), Number(row.latitude)] },
      deliveryRadiusKm: row.delivery_radius_km ? Number(row.delivery_radius_km) : undefined,
      distanceM: Math.round(row.distance_m),
      isOpenNow: isShopOpenNow(hoursByShop.get(row.id) ?? []),
    }));

    if (query.openNow === undefined) return withOpen;
    return withOpen.filter((s) => s.isOpenNow === query.openNow);
  }

  /**
   * Produits à proximité — le produit hérite de la position de sa boutique
   * (jointure), plutôt que la copier à la création comme le faisait Mongo :
   * elle ne peut donc jamais devenir périmée si la boutique déménage.
   */
  async nearbyProducts(query: NearbyProductQuery): Promise<unknown[]> {
    const { minLat, maxLat, minLng, maxLng } = GeoService.boundingBox(query.lat, query.lng, query.radiusKm);
    const radiusM = query.radiusKm * 1000;

    const categoryFilter = query.categoryId
      ? await this.categoryAndDescendants(Number(query.categoryId))
      : null;

    const rows = await this.prisma.$queryRaw<NearbyProductRow[]>`
      SELECT p.id, p.name, p.slug, p.price, p.promo_price, p.stock, p.shop_id,
             s.name AS shop_name, s.slug AS shop_slug,
             ST_Distance_Sphere(POINT(s.longitude, s.latitude), POINT(${query.lng}, ${query.lat})) AS distance_m
      FROM products p
      INNER JOIN shops s ON s.id = p.shop_id
      WHERE p.status = 'published' AND p.is_hidden = 0 AND p.is_available = 1
        AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
        AND s.latitude BETWEEN ${minLat} AND ${maxLat}
        AND s.longitude BETWEEN ${minLng} AND ${maxLng}
        AND ST_Distance_Sphere(POINT(s.longitude, s.latitude), POINT(${query.lng}, ${query.lat})) <= ${radiusM}
        ${categoryFilter ? Prisma.sql`AND p.category_id IN (${Prisma.join(categoryFilter)})` : Prisma.empty}
      ORDER BY distance_m
      LIMIT ${query.limit}
    `;

    if (rows.length === 0) return [];

    const images = await this.prisma.product_images.findMany({
      where: { product_id: { in: rows.map((r) => r.id) } },
    });
    const imagesByProduct = new Map<number, typeof images>();
    for (const image of images) {
      const list = imagesByProduct.get(image.product_id) ?? [];
      list.push(image);
      imagesByProduct.set(image.product_id, list);
    }

    return rows.map((row) => ({
      id: String(row.id),
      shopId: String(row.shop_id),
      shop: { name: row.shop_name, slug: row.shop_slug },
      name: row.name,
      slug: row.slug,
      price: row.price,
      promoPrice: row.promo_price ?? undefined,
      currency: 'MGA',
      stock: row.stock ?? 0,
      media: (imagesByProduct.get(row.id) ?? []).map((img) => ({
        ...this.media.publicUrls(img.image_path),
        type: img.media_type,
        isMain: img.is_main ?? false,
      })),
      distanceM: Math.round(row.distance_m),
    }));
  }

  private async openingHoursByShop(shopIds: number[]): Promise<Map<number, OpeningHourRow[]>> {
    const rows = await this.prisma.shop_opening_hours.findMany({ where: { shop_id: { in: shopIds } } });
    const byShop = new Map<number, OpeningHourRow[]>();
    for (const row of rows) {
      const list = byShop.get(row.shop_id) ?? [];
      list.push(row);
      byShop.set(row.shop_id, list);
    }
    return byShop;
  }

  private async categoryAndDescendants(categoryId: number): Promise<number[]> {
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
}
