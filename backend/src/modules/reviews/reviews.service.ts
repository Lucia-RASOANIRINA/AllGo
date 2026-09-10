import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { Review, type ReviewDocument, type ReviewTarget } from './schemas/review.schema';

/** `product`/`shop` (Phase 2, MySQL) stockent un entier ; `courier` (miroir Mongo) un ObjectId. */
function toStorageId(targetType: ReviewTarget, targetId: string): Types.ObjectId | number {
  return targetType === 'courier' ? new Types.ObjectId(targetId) : Number(targetId);
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    private readonly prisma: PrismaService,
  ) {}

  async list(targetType: ReviewTarget, targetId: string, limit = 20): Promise<unknown[]> {
    return this.reviews
      .find({ targetType, targetId: toStorageId(targetType, targetId) })
      .sort({ createdAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
  }

  /**
   * `orders`/`order_items` ont migré vers MySQL (Phase 3) : l'éligibilité
   * (« a bien reçu cette commande ») s'y vérifie directement, plus besoin du
   * `Order` Mongo. Le compte-rendu (`Review`) reste sur Mongo — non concerné.
   */
  async create(user: AuthenticatedUser, dto: CreateReviewDto): Promise<unknown> {
    const order = await this.prisma.orders.findFirst({
      where: { id: Number(dto.orderId), user_id: user.mysqlId },
      include: { order_items: true },
    });
    if (!order || order.status !== 'delivered') {
      throw new AppError('REVIEW_NOT_ELIGIBLE', 'Un avis est possible uniquement après une livraison.', 409);
    }
    const targetId = toStorageId(dto.targetType, dto.targetId);
    const eligible =
      dto.targetType === 'shop'
        ? String(order.shop_id) === dto.targetId
        : dto.targetType === 'courier'
          ? order.courier_id != null && String(order.courier_id) === dto.targetId
          : order.order_items.some((item) => item.product_id === targetId);
    if (!eligible) throw new AppError('REVIEW_TARGET_INVALID', 'Cette cible ne correspond pas à la commande.', 400);
    try {
      const review = await this.reviews.create({
        userId: this.objectId(user.id),
        orderId: order.id,
        targetType: dto.targetType,
        targetId,
        rating: dto.rating,
        comment: dto.comment,
        photos: dto.photos ?? [],
        verified: true,
      });
      await this.updateStats(dto.targetType, targetId);
      return review.toJSON();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new AppError('REVIEW_ALREADY_EXISTS', 'Vous avez déjà évalué cette cible pour cette commande.', 409);
      }
      throw error;
    }
  }

  async update(userId: string, id: string, dto: UpdateReviewDto): Promise<unknown> {
    const review = await this.reviews.findOne({ _id: this.objectId(id), userId: this.objectId(userId) });
    if (!review) throw new AppError('REVIEW_NOT_FOUND', 'Avis introuvable.', 404);
    Object.assign(review, dto);
    await review.save();
    await this.updateStats(review.targetType, review.targetId);
    return review.toJSON();
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    const review = await this.reviews.findOneAndDelete({ _id: this.objectId(id), userId: this.objectId(userId) });
    if (!review) throw new AppError('REVIEW_NOT_FOUND', 'Avis introuvable.', 404);
    await this.updateStats(review.targetType, review.targetId);
    return { deleted: true };
  }

  async report(userId: string, id: string, reason?: string): Promise<{ reported: true }> {
    const review = await this.reviews.findById(this.objectId(id));
    if (!review) throw new AppError('REVIEW_NOT_FOUND', 'Avis introuvable.', 404);
    await this.reviews.updateOne({ _id: review._id }, { $set: { reported: true, reportReason: reason } });
    return { reported: true };
  }

  /**
   * `product`/`shop` : moyenne/compte calculés à la demande depuis MySQL —
   * les avis y sont dupliqués via `updateOne` (pas de source de vérité
   * unique dans ce sens), mais aucune colonne dénormalisée à maintenir en
   * retour n'existe plus côté produit/boutique (§ décision Phase 2 : les
   * champs `stats.*` jamais maintenus ne sont pas reproduits).
   */
  private async updateStats(targetType: ReviewTarget, targetId: Types.ObjectId | number): Promise<void> {
    if (targetType === 'courier') return;
    // Rien à recalculer côté MySQL pour l'instant : `stats.rating`/`reviewCount`
    // sont dérivés à la lecture (voir `list()`), pas stockés.
    void targetId;
  }

  private objectId(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw new AppError('INVALID_ID', 'Identifiant invalide.', 400);
    return new Types.ObjectId(value);
  }
}
