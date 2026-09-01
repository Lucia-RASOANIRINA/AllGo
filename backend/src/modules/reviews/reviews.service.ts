import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppError } from '../../common/http/app-error';
import { Order, type OrderDocument } from '../orders/schemas/order.schema';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { Review, type ReviewDocument, type ReviewTarget } from './schemas/review.schema';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
  ) {}

  async list(targetType: ReviewTarget, targetId: string, limit = 20): Promise<unknown[]> {
    return this.reviews.find({ targetType, targetId: this.objectId(targetId) })
      .sort({ createdAt: -1 }).limit(Math.min(limit, 100)).lean();
  }

  async create(userId: string, dto: CreateReviewDto): Promise<unknown> {
    const order = await this.orders.findOne({ _id: this.objectId(dto.orderId), userId: this.objectId(userId) });
    if (!order || order.status !== 'delivered') {
      throw new AppError('REVIEW_NOT_ELIGIBLE', 'Un avis est possible uniquement après une livraison.', 409);
    }
    const targetId = this.objectId(dto.targetId);
    const eligible = dto.targetType === 'shop'
      ? String(order.shopId) === String(targetId)
      : dto.targetType === 'courier'
        ? String(order.delivery.courierId ?? '') === String(targetId)
        : order.items.some((item) => String(item.productId) === String(targetId));
    if (!eligible) throw new AppError('REVIEW_TARGET_INVALID', 'Cette cible ne correspond pas à la commande.', 400);
    try {
      const review = await this.reviews.create({
        userId: this.objectId(userId), orderId: order._id, targetType: dto.targetType,
        targetId, rating: dto.rating, comment: dto.comment, photos: dto.photos ?? [], verified: true,
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

  private async updateStats(targetType: ReviewTarget, targetId: Types.ObjectId): Promise<void> {
    const [result] = await this.reviews.aggregate<{ _id: null; average: number; count: number }>([
      { $match: { targetType, targetId, reported: false } },
      { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const stats = { rating: result?.average ?? 0, reviewCount: result?.count ?? 0 };
    if (targetType === 'product') await this.products.updateOne({ _id: targetId }, { $set: { 'stats.rating': stats.rating, 'stats.reviewCount': stats.reviewCount } });
    if (targetType === 'shop') await this.shops.updateOne({ _id: targetId }, { $set: { 'stats.rating': stats.rating, 'stats.reviewCount': stats.reviewCount } });
  }

  private objectId(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) throw new AppError('INVALID_ID', 'Identifiant invalide.', 400);
    return new Types.ObjectId(value);
  }
}
