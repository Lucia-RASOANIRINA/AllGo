import { Injectable } from '@nestjs/common';
import type { Prisma, promotions as PromotionRow } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import type { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';

/**
 * Promotions — table réelle `promotions` (Phase 4). `shop_id` est déjà un
 * entier MySQL natif : plus besoin du miroir Mongo boutique
 * (`ShopsService.resolveMirrorId`) pour ce module.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async list(shopId: string): Promise<unknown[]> {
    const rows = await this.prisma.promotions.findMany({
      where: { shop_id: Number(shopId) },
      orderBy: { starts_at: 'desc' },
    });
    return rows.map((row) => this.toJson(row));
  }

  async create(shopId: string, dto: CreatePromotionDto): Promise<unknown> {
    const row = await this.prisma.promotions.create({
      data: {
        shop_id: Number(shopId),
        title: dto.name,
        type: dto.type as never,
        value: dto.value,
        starts_at: new Date(dto.startsAt),
        ends_at: new Date(dto.endsAt),
        quantity_limit: dto.quantityLimit,
        coupon_code: dto.couponCode,
        flash: dto.flash ?? false,
        special_offer: dto.specialOffer ?? false,
        product_id: dto.productId ? Number(dto.productId) : undefined,
        active: dto.active ?? true,
      },
    });
    return this.toJson(row);
  }

  async update(shopId: string, id: string, dto: UpdatePromotionDto): Promise<unknown> {
    const data: Prisma.promotionsUpdateInput = {
      title: dto.name,
      type: dto.type as never,
      value: dto.value,
      starts_at: dto.startsAt ? new Date(dto.startsAt) : undefined,
      ends_at: dto.endsAt ? new Date(dto.endsAt) : undefined,
      quantity_limit: dto.quantityLimit,
      coupon_code: dto.couponCode,
      flash: dto.flash,
      special_offer: dto.specialOffer,
      products: dto.productId ? { connect: { id: Number(dto.productId) } } : undefined,
      active: dto.active,
      updated_at: new Date(),
    };

    const result = await this.prisma.promotions.updateMany({
      where: { id: Number(id), shop_id: Number(shopId) },
      data,
    });
    if (!result.count) throw AppError.notFound('Promotion');
    const row = await this.prisma.promotions.findUnique({ where: { id: Number(id) } });
    return this.toJson(row!);
  }

  async remove(shopId: string, id: string): Promise<{ deleted: true }> {
    const result = await this.prisma.promotions.deleteMany({ where: { id: Number(id), shop_id: Number(shopId) } });
    if (!result.count) throw AppError.notFound('Promotion');
    return { deleted: true };
  }

  /** Promotions flash actives, avec leur produit — rail « Promotions flash » de l'accueil (§1.B). */
  async activeFlash(limit: number): Promise<unknown[]> {
    const now = new Date();
    const rows = await this.prisma.promotions.findMany({
      where: { flash: true, active: true, starts_at: { lte: now }, ends_at: { gte: now }, product_id: { not: null } },
      orderBy: { starts_at: 'desc' },
      take: limit,
      include: {
        products: {
          where: { status: 'published', is_hidden: false },
          include: { shops: { select: { name: true, slug: true } }, product_images: true },
        },
      },
    });

    return rows
      .filter((row) => row.products)
      .map((row) => {
        const product = row.products!;
        return {
          promotionId: String(row.id),
          endsAt: row.ends_at,
          product: {
            id: product.id,
            name: product.name,
            slug: product.slug,
            price: product.price,
            promoPrice: product.promo_price ?? undefined,
            currency: 'MGA',
            stock: product.stock ?? 0,
            shopId: String(product.shop_id),
            shop: product.shops ? { name: product.shops.name, slug: product.shops.slug } : undefined,
            media: product.product_images.map((img) => ({
              ...this.media.publicUrls(img.image_path),
              type: img.media_type,
              isMain: img.is_main ?? false,
            })),
          },
        };
      });
  }

  private toJson(row: PromotionRow): unknown {
    return {
      id: String(row.id),
      shopId: String(row.shop_id),
      name: row.title,
      description: row.description ?? undefined,
      type: row.type,
      value: row.value,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      quantityLimit: row.quantity_limit ?? undefined,
      couponCode: row.coupon_code ?? undefined,
      flash: row.flash,
      specialOffer: row.special_offer,
      productId: row.product_id ? String(row.product_id) : undefined,
      active: row.active,
      redeemedCount: row.redeemed_count,
      location:
        row.latitude != null && row.longitude != null
          ? { latitude: row.latitude, longitude: row.longitude, radiusKm: row.radius_km ?? undefined }
          : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
