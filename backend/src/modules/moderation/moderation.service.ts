import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
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

/** Au-delà de ce nombre de signalements en attente, le contenu est masqué sans attendre un modérateur (§29). */
const AUTO_HIDE_REPORT_THRESHOLD = 3;

/**
 * `product`/`shop` (Phase 2) et `post`/`comment` (Phase 4, MySQL) stockent un
 * entier ; `user` (miroir Mongo, pas encore basculé — Phase 6) un ObjectId.
 */
function toStorageId(targetType: ReportTargetType, targetId: string): Types.ObjectId | number {
  return targetType === 'user' ? new Types.ObjectId(targetId) : Number(targetId);
}

@Injectable()
export class ModerationService {
  constructor(
    @InjectModel(Report.name) private readonly reports: Model<ReportDocument>,
    @InjectModel(Sanction.name) private readonly sanctions: Model<SanctionDocument>,
    @InjectModel(BannedWord.name) private readonly bannedWords: Model<BannedWordDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly prisma: PrismaService,
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
        targetId: toStorageId(input.targetType, input.targetId),
        status: 'pending',
      });
      if (duplicate) {
        throw new AppError('ALREADY_REPORTED', 'Vous avez déjà signalé ce contenu — la modération l’examine.', 409);
      }
    }

    await this.reports.create({
      reporterId: input.reporterId ? new Types.ObjectId(input.reporterId) : null,
      targetType: input.targetType,
      targetId: toStorageId(input.targetType, input.targetId),
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
      targetId: toStorageId(targetType, targetId),
      status: 'pending',
    });
    if (pendingCount < AUTO_HIDE_REPORT_THRESHOLD) return;

    const reason = `Masqué automatiquement après ${pendingCount} signalements.`;
    if (targetType === 'post') {
      await this.prisma.posts.update({ where: { id: Number(targetId) }, data: { reported: true, report_reason: reason } });
    } else if (targetType === 'comment') {
      await this.prisma.comments.update({ where: { id: Number(targetId) }, data: { reported: true, report_reason: reason } });
    } else {
      // `isReported` n'existe plus côté MySQL (Phase 2) — déduit de `reports`
      // (voir `AdministrationService.reportedProducts`) ; seul `is_hidden` reste à écrire.
      await this.prisma.products.update({ where: { id: Number(targetId) }, data: { is_hidden: true } });
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
        await this.prisma.posts.delete({ where: { id: Number(targetId) } });
        break;
      case 'comment':
        // Pas de compteur dénormalisé à décrémenter (§ décision Phase 4) : le
        // nombre de commentaires d'une publication se calcule à la lecture.
        await this.prisma.comments.delete({ where: { id: Number(targetId) } });
        break;
      case 'product':
        await this.prisma.products.update({ where: { id: Number(targetId) }, data: { status: 'archived', is_hidden: true } });
        break;
      case 'shop':
        await this.prisma.shops.update({ where: { id: Number(targetId) }, data: { status: 'suspended' } });
        break;
      case 'user':
        // `targetId` reste l'ObjectId du miroir (Phase 6 bascule l'identité
        // de session sur l'entier MySQL) — résolu ici vers `users.id` réel :
        // MySQL est l'unique source vérifiée par `AuthService.login()`,
        // écrire seulement le miroir laissait un compte « supprimé » par la
        // modération pleinement capable de se reconnecter (même défaut que
        // celui corrigé dans `AdministrationService`, avant la Phase 5).
        await this.suspendMirroredUser(targetId);
        break;
    }
    return { removed: true };
  }

  // --- Blocage compte-à-compte — table réelle `user_blocks` (Phase 4) -----

  async blockUser(blockerId: number, blockedId: number): Promise<{ blocked: true }> {
    if (blockerId === blockedId) {
      throw new AppError('CANNOT_BLOCK_SELF', 'Vous ne pouvez pas vous bloquer vous-même.', 400);
    }
    await this.prisma.user_blocks.upsert({
      where: { blocker_id_blocked_id: { blocker_id: blockerId, blocked_id: blockedId } },
      create: { blocker_id: blockerId, blocked_id: blockedId },
      update: {},
    });
    return { blocked: true };
  }

  async unblockUser(blockerId: number, blockedId: number): Promise<{ blocked: false }> {
    await this.prisma.user_blocks.deleteMany({ where: { blocker_id: blockerId, blocked_id: blockedId } });
    return { blocked: false };
  }

  listBlockedUsers(blockerId: number) {
    return this.prisma.user_blocks.findMany({
      where: { blocker_id: blockerId },
      orderBy: { created_at: 'desc' },
      include: { users_user_blocks_blocked_idTousers: { select: { id: true, firstname: true, lastname: true, avatar: true } } },
    });
  }

  /** Vrai si l'un bloque l'autre, dans un sens ou dans l'autre — un blocage ferme le canal pour les deux. */
  async isBlockedEitherWay(userA: number, userB: number): Promise<boolean> {
    const count = await this.prisma.user_blocks.count({
      where: {
        OR: [
          { blocker_id: userA, blocked_id: userB },
          { blocker_id: userB, blocked_id: userA },
        ],
      },
    });
    return count > 0;
  }

  async blockedAuthorIds(blockerId: number): Promise<number[]> {
    const rows = await this.prisma.user_blocks.findMany({ where: { blocker_id: blockerId }, select: { blocked_id: true } });
    return rows.map((r) => r.blocked_id);
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
      await this.suspendMirroredUser(input.userId);
    }
    return sanction.toJSON();
  }

  sanctionsFor(userId: string) {
    return this.sanctions.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).lean();
  }

  /**
   * Résout l'ObjectId du miroir vers l'entier MySQL réel et suspend LE
   * compte, jamais seulement sa copie miroir — `AuthService.login()` ne
   * vérifie que `prisma.users.status` (§ décision du 2026-09-09, mise en
   * marché : un compte « suspendu » qui reste connectable n'est pas suspendu).
   */
  private async suspendMirroredUser(mirrorId: string): Promise<void> {
    const mirror = await this.users.findById(mirrorId).select('mysqlId').lean();
    if (!mirror?.mysqlId) return;
    await this.prisma.users.update({ where: { id: mirror.mysqlId }, data: { status: 'suspended' } });
  }

  // --- Liste noire (comptes suspendus/bannis) -----------------------------

  blacklist() {
    return this.prisma.users.findMany({
      where: { status: 'suspended' },
      select: { id: true, phone: true, email: true, firstname: true, lastname: true, status: true, created_at: true },
      orderBy: { updated_at: 'desc' },
      take: 200,
    });
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
      await this.prisma.posts.update({ where: { id: Number(targetId) }, data: { reported: true, report_reason: reason } });
    } else {
      await this.prisma.comments.update({ where: { id: Number(targetId) }, data: { reported: true, report_reason: reason } });
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
