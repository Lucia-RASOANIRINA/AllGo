import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ReportAction, ReportReasonCode, ReportStatus, ReportTargetType } from './schemas/report.schema';
import type { SanctionType } from './schemas/sanction.schema';

/** Au-delà de ce nombre de signalements en attente, le contenu est masqué sans attendre un modérateur (§29). */
const AUTO_HIDE_REPORT_THRESHOLD = 3;

const REPORT_INCLUDE = {
  users_reports_reporter_idTousers: { select: { firstname: true, lastname: true } },
} satisfies Prisma.reportsInclude;

/**
 * Modération — `reports`/`sanctions`/`banned_words` sont des tables réelles
 * depuis la Phase 5 (`user_blocks` depuis la Phase 4). Tous les identifiants
 * (acteur ET cible) sont des entiers MySQL directs depuis la bascule
 * d'identité (Phase 6).
 */
@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Signalements ---------------------------------------------------

  async fileReport(input: {
    reporterId: number | null;
    targetType: ReportTargetType;
    targetId: string;
    reason?: string;
    reasonCode?: ReportReasonCode;
    automatic?: boolean;
  }): Promise<{ reported: true }> {
    const reportableId = Number(input.targetId);

    if (input.reporterId) {
      const duplicate = await this.prisma.reports.findFirst({
        where: {
          reporter_id: input.reporterId,
          reportable_type: input.targetType,
          reportable_id: reportableId,
          status: 'pending',
        },
      });
      if (duplicate) {
        throw new AppError('ALREADY_REPORTED', 'Vous avez déjà signalé ce contenu — la modération l’examine.', 409);
      }
    }

    await this.prisma.reports.create({
      data: {
        reporter_id: input.reporterId,
        reportable_type: input.targetType,
        reportable_id: reportableId,
        reason: input.reason?.trim() || 'Signalement sans motif précisé.',
        reason_code: input.reasonCode ?? (input.automatic ? 'automatic_filter' : 'other'),
        automatic: input.automatic ?? false,
      },
    });

    await this.autoHideIfThresholdReached(input.targetType, reportableId);
    return { reported: true };
  }

  private async autoHideIfThresholdReached(targetType: ReportTargetType, reportableId: number): Promise<void> {
    if (targetType !== 'post' && targetType !== 'comment' && targetType !== 'product') return;
    const pendingCount = await this.prisma.reports.count({
      where: { reportable_type: targetType, reportable_id: reportableId, status: 'pending' },
    });
    if (pendingCount < AUTO_HIDE_REPORT_THRESHOLD) return;

    const reason = `Masqué automatiquement après ${pendingCount} signalements.`;
    if (targetType === 'post') {
      await this.prisma.posts.update({ where: { id: reportableId }, data: { reported: true, report_reason: reason } });
    } else if (targetType === 'comment') {
      await this.prisma.comments.update({ where: { id: reportableId }, data: { reported: true, report_reason: reason } });
    } else {
      // `isReported` n'existe plus côté MySQL (Phase 2) — déduit de `reports`
      // (voir `AdministrationService.reportedProducts`) ; seul `is_hidden` reste à écrire.
      await this.prisma.products.update({ where: { id: reportableId }, data: { is_hidden: true } });
    }
  }

  async listReports(status?: ReportStatus, targetType?: ReportTargetType): Promise<unknown[]> {
    const rows = await this.prisma.reports.findMany({
      where: { status: status as never, reportable_type: targetType as never },
      include: REPORT_INCLUDE,
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    return Promise.all(rows.map((row) => this.reportToJson(row)));
  }

  async resolveReport(
    id: string,
    resolvedByMysqlId: number,
    input: { status: 'dismissed' | 'actioned'; action?: ReportAction; resolution?: string; sanctionUserId?: string; suspensionDays?: number },
  ): Promise<unknown> {
    const report = await this.prisma.reports.findUnique({ where: { id: Number(id) } });
    if (!report) throw AppError.notFound('Signalement');

    const action: ReportAction = input.status === 'dismissed' ? 'none' : (input.action ?? 'content_removed');

    if (input.status === 'actioned') {
      if (action === 'content_removed') {
        await this.removeContent(report.reportable_type as ReportTargetType, String(report.reportable_id));
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
          issuedBy: resolvedByMysqlId,
          reportId: report.id,
          expiresAt,
        });
      }
    }

    const updated = await this.prisma.reports.update({
      where: { id: report.id },
      data: {
        status: input.status,
        action,
        resolution: input.resolution,
        resolved_by: resolvedByMysqlId,
        resolved_at: new Date(),
      },
      include: REPORT_INCLUDE,
    });
    return this.reportToJson(updated);
  }

  private reportToJson(row: Prisma.reportsGetPayload<{ include: typeof REPORT_INCLUDE }>): unknown {
    return {
      id: String(row.id),
      reporterId: row.reporter_id ? String(row.reporter_id) : null,
      reporterName: row.users_reports_reporter_idTousers
        ? `${row.users_reports_reporter_idTousers.firstname} ${row.users_reports_reporter_idTousers.lastname}`.trim()
        : undefined,
      targetType: row.reportable_type,
      targetId: String(row.reportable_id),
      reason: row.reason,
      reasonCode: row.reason_code,
      automatic: row.automatic,
      status: row.status,
      action: row.action,
      resolution: row.resolution ?? undefined,
      resolvedAt: row.resolved_at ?? undefined,
      createdAt: row.created_at,
    };
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
        await this.prisma.users.update({ where: { id: Number(targetId) }, data: { status: 'suspended' } });
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
    issuedBy: number;
    reportId?: number;
    expiresAt?: Date;
  }): Promise<unknown> {
    const mysqlId = Number(input.userId);
    if (!Number.isInteger(mysqlId)) throw AppError.notFound('Utilisateur');

    const sanction = await this.prisma.sanctions.create({
      data: {
        user_id: mysqlId,
        type: input.type,
        reason: input.reason,
        issued_by: input.issuedBy,
        report_id: input.reportId,
        expires_at: input.expiresAt,
      },
    });
    if (input.type === 'suspension' || input.type === 'ban') {
      await this.prisma.users.update({ where: { id: mysqlId }, data: { status: 'suspended' } });
    }
    return this.sanctionToJson(sanction, input.userId);
  }

  async sanctionsFor(userId: string): Promise<unknown[]> {
    const mysqlId = Number(userId);
    if (!Number.isInteger(mysqlId)) return [];
    const rows = await this.prisma.sanctions.findMany({ where: { user_id: mysqlId }, orderBy: { created_at: 'desc' } });
    return rows.map((row) => this.sanctionToJson(row, userId));
  }

  private sanctionToJson(row: Prisma.sanctionsGetPayload<Record<string, never>>, userMirrorId: string): unknown {
    return {
      id: String(row.id),
      userId: userMirrorId,
      type: row.type,
      reason: row.reason,
      reportId: row.report_id ? String(row.report_id) : undefined,
      expiresAt: row.expires_at ?? undefined,
      createdAt: row.created_at,
    };
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

  async addBannedWord(word: string, addedByMysqlId: number): Promise<unknown> {
    const normalized = word.trim().toLowerCase();
    const existing = await this.prisma.banned_words.upsert({
      where: { word: normalized },
      create: { word: normalized, added_by: addedByMysqlId },
      update: {},
    });
    return { id: String(existing.id), word: existing.word, createdAt: existing.created_at };
  }

  async removeBannedWord(id: string): Promise<{ deleted: boolean }> {
    const result = await this.prisma.banned_words.deleteMany({ where: { id: Number(id) } });
    return { deleted: result.count > 0 };
  }

  async listBannedWords(): Promise<unknown[]> {
    const rows = await this.prisma.banned_words.findMany({ orderBy: { word: 'asc' } });
    return rows.map((row) => ({ id: String(row.id), word: row.word, createdAt: row.created_at }));
  }

  /** Renvoie le premier mot interdit trouvé dans `content`, ou `null` si aucun. */
  async findBannedWord(content: string | undefined): Promise<string | null> {
    if (!content?.trim()) return null;
    const words = await this.prisma.banned_words.findMany({ select: { word: true } });
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
