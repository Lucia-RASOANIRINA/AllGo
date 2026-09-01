import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppError } from '../../common/http/app-error';
import { Promotion, type PromotionDocument } from './schemas/promotion.schema';
import type { CreatePromotionDto, UpdatePromotionDto } from './dto/promotion.dto';

@Injectable()
export class CampaignsService {
  constructor(@InjectModel(Promotion.name) private readonly promotions: Model<PromotionDocument>) {}
  list(shopId: string) { return this.promotions.find({ shopId: new Types.ObjectId(shopId) }).sort({ startsAt: -1 }).lean(); }
  async create(shopId: string, dto: CreatePromotionDto) {
    return (await this.promotions.create({ ...dto, shopId: new Types.ObjectId(shopId), startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt) })).toJSON();
  }
  async update(shopId: string, id: string, dto: UpdatePromotionDto) {
    const promotion = await this.promotions.findOneAndUpdate({ _id: id, shopId: new Types.ObjectId(shopId) }, { $set: { ...dto, startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined, endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined } }, { new: true, runValidators: true });
    if (!promotion) throw AppError.notFound('Promotion');
    return promotion.toJSON();
  }
  async remove(shopId: string, id: string) {
    const result = await this.promotions.deleteOne({ _id: id, shopId: new Types.ObjectId(shopId) });
    if (!result.deletedCount) throw AppError.notFound('Promotion');
    return { deleted: true };
  }

  /**
   * Promotions flash actives, avec leur produit — rail « Promotions flash »
   * de l'accueil (§1.B). `productId` est optionnel sur `Promotion` : seules
   * celles qui en portent un peuvent alimenter ce rail.
   */
  async activeFlash(limit: number): Promise<unknown[]> {
    const now = new Date();
    return this.promotions.aggregate([
      {
        $match: {
          flash: true,
          active: true,
          startsAt: { $lte: now },
          endsAt: { $gte: now },
          productId: { $exists: true },
        },
      },
      { $sort: { startsAt: -1 } },
      { $limit: limit },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $match: { 'product.status': 'published', 'product.isHidden': { $ne: true } } },
      {
        $project: {
          _id: 0,
          promotionId: '$_id',
          endsAt: 1,
          product: {
            _id: 1,
            name: 1,
            slug: 1,
            price: 1,
            promoPrice: 1,
            currency: 1,
            media: 1,
            stock: 1,
            shop: 1,
            shopId: 1,
            stats: 1,
          },
        },
      },
    ]);
  }
}
