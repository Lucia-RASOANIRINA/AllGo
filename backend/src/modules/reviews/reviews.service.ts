import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import type { ReviewTarget } from './schemas/review.schema';

const REVIEW_INCLUDE = { users: { select: { firstname: true, lastname: true, avatar: true } } } satisfies Prisma.product_reviewsInclude;
type ReviewRow = Prisma.product_reviewsGetPayload<{ include: typeof REVIEW_INCLUDE }>;

/**
 * Avis — table réelle `product_reviews` (Phase 5), élargie à `shop`/
 * `courier` et liée à une commande. `target_id` est toujours l'entier
 * MySQL réel, y compris pour `courier` (`users.id` direct, déjà connu via
 * `mysqlId` — plus besoin du miroir Mongo pour cette cible depuis cette
 * migration).
 */
@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(targetType: ReviewTarget, targetId: string, limit = 20): Promise<unknown[]> {
    const rows = await this.prisma.product_reviews.findMany({
      where: { target_type: targetType, target_id: Number(targetId), reported: false },
      include: REVIEW_INCLUDE,
      orderBy: { created_at: 'desc' },
      take: Math.min(limit, 100),
    });
    return rows.map((row) => this.toJson(row));
  }

  /**
   * `orders`/`order_items` sont des tables MySQL réelles (Phase 3) :
   * l'éligibilité (« a bien reçu cette commande ») s'y vérifie directement.
   */
  async create(user: AuthenticatedUser, dto: CreateReviewDto): Promise<unknown> {
    const order = await this.prisma.orders.findFirst({
      where: { id: Number(dto.orderId), user_id: user.mysqlId },
      include: { order_items: true },
    });
    if (!order || order.status !== 'delivered') {
      throw new AppError('REVIEW_NOT_ELIGIBLE', 'Un avis est possible uniquement après une livraison.', 409);
    }
    const targetId = Number(dto.targetId);
    const eligible =
      dto.targetType === 'shop'
        ? order.shop_id === targetId
        : dto.targetType === 'courier'
          ? order.courier_id != null && order.courier_id === targetId
          : order.order_items.some((item) => item.product_id === targetId);
    if (!eligible) throw new AppError('REVIEW_TARGET_INVALID', 'Cette cible ne correspond pas à la commande.', 400);

    try {
      const review = await this.prisma.product_reviews.create({
        data: {
          user_id: user.mysqlId,
          order_id: order.id,
          target_type: dto.targetType,
          target_id: targetId,
          product_id: dto.targetType === 'product' ? targetId : undefined,
          rating: dto.rating,
          comment: dto.comment,
          photos: dto.photos?.length ? JSON.stringify(dto.photos) : undefined,
          verified: true,
        },
        include: REVIEW_INCLUDE,
      });
      return this.toJson(review);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new AppError('REVIEW_ALREADY_EXISTS', 'Vous avez déjà évalué cette cible pour cette commande.', 409);
      }
      throw error;
    }
  }

  async update(userMysqlId: number, id: string, dto: UpdateReviewDto): Promise<unknown> {
    const result = await this.prisma.product_reviews.updateMany({
      where: { id: Number(id), user_id: userMysqlId },
      data: {
        rating: dto.rating,
        comment: dto.comment,
        photos: dto.photos?.length ? JSON.stringify(dto.photos) : undefined,
      },
    });
    if (!result.count) throw new AppError('REVIEW_NOT_FOUND', 'Avis introuvable.', 404);
    const review = await this.prisma.product_reviews.findUnique({ where: { id: Number(id) }, include: REVIEW_INCLUDE });
    return this.toJson(review!);
  }

  async remove(userMysqlId: number, id: string): Promise<{ deleted: true }> {
    const result = await this.prisma.product_reviews.deleteMany({ where: { id: Number(id), user_id: userMysqlId } });
    if (!result.count) throw new AppError('REVIEW_NOT_FOUND', 'Avis introuvable.', 404);
    return { deleted: true };
  }

  async report(id: string, reason?: string): Promise<{ reported: true }> {
    const result = await this.prisma.product_reviews.updateMany({
      where: { id: Number(id) },
      data: { reported: true, report_reason: reason },
    });
    if (!result.count) throw new AppError('REVIEW_NOT_FOUND', 'Avis introuvable.', 404);
    return { reported: true };
  }

  private toJson(row: ReviewRow): unknown {
    return {
      id: String(row.id),
      userId: String(row.user_id),
      author: { name: `${row.users.firstname} ${row.users.lastname}`.trim(), avatar: row.users.avatar ?? undefined },
      orderId: row.order_id ? String(row.order_id) : undefined,
      targetType: row.target_type,
      targetId: row.target_id ? String(row.target_id) : undefined,
      rating: row.rating,
      comment: row.comment ?? undefined,
      photos: row.photos ? (JSON.parse(row.photos) as string[]) : [],
      verified: row.verified,
      createdAt: row.created_at,
    };
  }
}
