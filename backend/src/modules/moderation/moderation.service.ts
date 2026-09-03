import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { Comment, type CommentDocument } from '../social/schemas/interactions.schema';
import { Post, type PostDocument } from '../social/schemas/post.schema';
import { Product, type ProductDocument } from '../catalog/schemas/product.schema';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import { User, type UserDocument } from '../users/schemas/user.schema';
import { BannedWord, type BannedWordDocument } from './schemas/banned-word.schema';
import {
  Report,
  type ReportAction,
  type ReportDocument,
  type ReportReasonCode,
  type ReportStatus,
  type ReportTargetType,
} from './schemas/report.schema';
import { Sanction, type SanctionDocument, type SanctionType } from './schemas/sanction.schema';
import { UserBlock, type UserBlockDocument } from './schemas/user-block.schema';

/** Au-delà de ce nombre de signalements en attente, le contenu est masqué sans attendre un modérateur (§29). */
const AUTO_HIDE_REPORT_THRESHOLD = 3;

@Injectable()
export class ModerationService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<ReportDocument>,
    @InjectModel(Sanction.name) private readonly sanctions: Model<SanctionDocument>,
    @InjectModel(UserBlock.name) private readonly blocks: Model<UserBlockDocument>,
    @InjectModel(BannedWord.name) private readonly bannedWords: Model<BannedWordDocument>,
    @InjectModel(Post.name) private readonly posts: Model<PostDocument>,
    @InjectModel(Comment.name) private readonly comments: Model<CommentDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  // --- Signalements ---------------------------------------------------

  async fileReport(input: {
    reporterId: string | null;
    targetType: ReportTargetType;
    targetId: string;
    reason?: string;
    reasonCode?: ReportReasonCode;
    automatic?: boolean;
  }): Promise<{ reported: true }> {
    if (input.reporterId) {
      const duplicate = await this.reports.exists({
        reporterId: new Types.ObjectId(input.reporterId),
        targetType: input.targetType,
        targetId: new Types.ObjectId(input.targetId),
        status: 'pending',
      });
      if (duplicate) {
        throw new AppError('ALREADY_REPORTED', 'Vous avez déjà signalé ce contenu — la modération l’examine.', 409);
      }
    }

    await this.reports.create({
      reporterId: input.reporterId ? new Types.ObjectId(input.reporterId) : null,
      targetType: input.targetType,
      targetId: new Types.ObjectId(input.targetId),
      reason: input.reason?.trim() || 'Signalement sans motif précisé.',
      reasonCode: input.reasonCode ?? (input.automatic ? 'automatic_filter' : 'other'),
      automatic: input.automatic ?? false,
    });

    await this.autoHideIfThresholdReached(input.targetType, input.targetId);
    return { reported: true };
  }

  private async autoHideIfThresholdReached(targetType: ReportTargetType, targetId: string): Promise<void> {
    if (targetType !== 'post' && targetType !== 'comment' && targetType !== 'product') return;
    const pendingCount = await this.reports.countDocuments({
      targetType,
      targetId: new Types.ObjectId(targetId),
      status: 'pending',
    });
    if (pendingCount < AUTO_HIDE_REPORT_THRESHOLD) return;

    const reason = `Masqué automatiquement après ${pendingCount} signalements.`;
    if (targetType === 'post') {
      await this.posts.updateOne({ _id: targetId }, { $set: { reported: true, reportReason: reason } });
    } else if (targetType === 'comment') {
      await this.comments.updateOne({ _id: targetId }, { $set: { reported: true, reportReason: reason } });
    } else {
      await this.products.updateOne({ _id: targetId }, { $set: { isHidden: true, isReported: true } });
    }
  }

  listReports(status?: ReportStatus, targetType?: ReportTargetType) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (targetType) filter.targetType = targetType;
    return this.reports.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  }

  async resolveReport(
    id: string,
    resolvedBy: string,
    input: { status: 'dismissed' | 'actioned'; action?: ReportAction; resolution?: string; sanctionUserId?: string; suspensionDays?: number },
  ) {
    const report = await this.reports.findById(id);
    if (!report) throw AppError.notFound('Signalement');

    const action: ReportAction = input.status === 'dismissed' ? 'none' : (input.action ?? 'content_removed');

    if (input.status === 'actioned') {
      if (action === 'content_removed') {
        await this.removeContent(report.targetType, String(report.targetId));
      } else if (action === 'warning' || action === 'suspension' || action === 'ban') {
        if (!input.sanctionUserId) {
          throw new AppError('SANCTION_TARGET_REQUIRED', 'Précisez le compte à sanctionner pour cette action.', 400);
        }
        const expiresAt =
          action === 'suspension' && input.suspensionDays
            ? new Date(Date.now() + input.suspensionDays * 24 * 60 * 60 * 1000)
            : undefined;
        await this.sanctionUser({
          userId: input.sanctionUserId,
          type: action as SanctionType,
          reason: input.resolution ?? report.reason,
          issuedBy: resolvedBy,
          reportId: id,
          expiresAt,
        });
      }
    }

    report.status = input.status;
    report.action = action;
    report.resolution = input.resolution;
    report.resolvedBy = new Types.ObjectId(resolvedBy);
    report.resolvedAt = new Date();
    await report.save();
    return report.toJSON();
  }

  /** Retrait direct d'un contenu par la modération, sans passer par un signalement préalable. */
  async removeContent(targetType: ReportTargetType, targetId: string): Promise<{ removed: true }> {
    switch (targetType) {
      case 'post':
        await this.posts.deleteOne({ _id: targetId });
        break;
      case 'comment': {
        const comment = await this.comments.findOneAndDelete({ _id: targetId });
        if (comment) await this.posts.updateOne({ _id: comment.postId }, { $inc: { 'counters.comments': -1 } });
        break;
      }
      case 'product':
        await this.products.updateOne({ _id: targetId }, { $set: { status: 'archived', isHidden: true, isReported: true } });
        break;
      case 'shop':
        await this.shops.updateOne({ _id: targetId }, { $set: { status: 'suspended' } });
        break;
      case 'user':
        await this.users.updateOne({ _id: targetId }, { $set: { status: 'suspended' } });
        break;
    }
    return { removed: true };
  }

  // --- Blocage compte-à-compte ------------------------------------------

  async blockUser(blockerId: string, blockedId: string): Promise<{ blocked: true }> {
    if (blockerId === blockedId) {
      throw new AppError('CANNOT_BLOCK_SELF', 'Vous ne pouvez pas vous bloquer vous-même.', 400);
    }
    await this.blocks.updateOne(
      { blockerId: new Types.ObjectId(blockerId), blockedId: new Types.ObjectId(blockedId) },
      { $setOnInsert: { blockerId: new Types.ObjectId(blockerId), blockedId: new Types.ObjectId(blockedId) } },
      { upsert: true },
    );
    return { blocked: true };
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<{ blocked: false }> {
    await this.blocks.deleteOne({ blockerId: new Types.ObjectId(blockerId), blockedId: new Types.ObjectId(blockedId) });
    return { blocked: false };
  }

  listBlockedUsers(blockerId: string) {
    return this.blocks.find({ blockerId: new Types.ObjectId(blockerId) }).sort({ createdAt: -1 }).lean();
  }

  /** Vrai si l'un bloque l'autre, dans un sens ou dans l'autre — un blocage ferme le canal pour les deux. */
  async isBlockedEitherWay(userA: string, userB: string): Promise<boolean> {
    const count = await this.blocks.countDocuments({
      $or: [
        { blockerId: new Types.ObjectId(userA), blockedId: new Types.ObjectId(userB) },
        { blockerId: new Types.ObjectId(userB), blockedId: new Types.ObjectId(userA) },
      ],
    });
    return count > 0;
  }

  async blockedAuthorIds(blockerId: string): Promise<Types.ObjectId[]> {
    return this.blocks.find({ blockerId: new Types.ObjectId(blockerId) }).distinct('blockedId');
  }

  // --- Sanctions ---------------------------------------------------------

  async sanctionUser(input: {
    userId: string;
    type: SanctionType;
    reason: string;
    issuedBy: string;
    reportId?: string;
    expiresAt?: Date;
  }) {
    const sanction = await this.sanctions.create({
      userId: new Types.ObjectId(input.userId),
      type: input.type,
      reason: input.reason,
      issuedBy: new Types.ObjectId(input.issuedBy),
      reportId: input.reportId ? new Types.ObjectId(input.reportId) : undefined,
      expiresAt: input.expiresAt,
    });
    if (input.type === 'suspension' || input.type === 'ban') {
      await this.users.updateOne({ _id: input.userId }, { $set: { status: 'suspended' } });
    }
    return sanction.toJSON();
  }

  sanctionsFor(userId: string) {
    return this.sanctions.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).lean();
  }

  // --- Liste noire (comptes suspendus/bannis) -----------------------------

  blacklist() {
    return this.users
      .find({ status: 'suspended' })
      .select('phone email firstName lastName status createdAt')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
  }

  // --- Modération automatique (mots interdits) ----------------------------

  async addBannedWord(word: string, addedBy: string) {
    const normalized = word.trim().toLowerCase();
    const existing = await this.bannedWords.findOneAndUpdate(
      { word: normalized },
      { $setOnInsert: { word: normalized, addedBy: new Types.ObjectId(addedBy) } },
      { upsert: true, new: true },
    );
    return existing.toJSON();
  }

  async removeBannedWord(id: string): Promise<{ deleted: boolean }> {
    const result = await this.bannedWords.deleteOne({ _id: id });
    return { deleted: result.deletedCount > 0 };
  }

  listBannedWords() {
    return this.bannedWords.find().sort({ word: 1 }).lean();
  }

  /** Renvoie le premier mot interdit trouvé dans `content`, ou `null` si aucun. */
  async findBannedWord(content: string | undefined): Promise<string | null> {
    if (!content?.trim()) return null;
    const words = await this.bannedWords.find().select('word').lean();
    if (words.length === 0) return null;
    const haystack = content.toLowerCase();
    const match = words.find(({ word }) => haystack.includes(word));
    return match?.word ?? null;
  }

  /**
   * Applique le filtre automatique à une publication ou un commentaire déjà
   * créé : masque le contenu et dépose un signalement système si un mot
   * interdit y figure. Appelé juste après la création (§29) — jamais avant,
   * pour ne jamais bloquer la création elle-même sur un faux positif.
   */
  async autoModerate(
    targetType: 'post' | 'comment',
    targetId: string,
    content: string | undefined,
  ): Promise<{ reported: true; reportReason: string } | null> {
    const match = await this.findBannedWord(content);
    if (!match) return null;

    const reason = `Filtrage automatique : le terme « ${match} » est interdit.`;
    if (targetType === 'post') {
      await this.posts.updateOne({ _id: targetId }, { $set: { reported: true, reportReason: reason } });
    } else {
      await this.comments.updateOne({ _id: targetId }, { $set: { reported: true, reportReason: reason } });
    }
    await this.fileReport({
      reporterId: null,
      targetType,
      targetId,
      reason,
      reasonCode: 'automatic_filter',
      automatic: true,
    });
    return { reported: true, reportReason: reason };
  }
}
