import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';

const STORY_INCLUDE = {
  users: { select: { firstname: true, lastname: true, avatar: true } },
  _count: { select: { story_views: true, story_reactions: true } },
} satisfies Prisma.storiesInclude;

type StoryRow = Prisma.storiesGetPayload<{ include: typeof STORY_INCLUDE }>;

/**
 * Stories — table réelle `stories` (Phase 4), 100 % MySQL depuis la bascule
 * d'identité (Phase 6).
 *
 * Purge : MariaDB n'a pas d'équivalent natif à l'index TTL Mongo — `list()`
 * filtre déjà sur `expires_at > now()`, une story expirée n'apparaît jamais ;
 * `purgeExpired()` nettoie les lignes elles-mêmes (hygiène de table, aucun
 * comportement visible), appelée par `StoriesCleanupService` (`@Cron`).
 */
@Injectable()
export class StoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async list(): Promise<unknown[]> {
    const rows = await this.prisma.stories.findMany({
      where: { expires_at: { gt: new Date() } },
      include: STORY_INCLUDE,
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map((row) => this.toJson(row)));
  }

  async create(
    user: AuthenticatedUser,
    input: { key: string; type: 'image' | 'video'; productId?: string; promotionId?: string },
  ): Promise<unknown> {
    const row = await this.prisma.stories.create({
      data: {
        user_id: user.mysqlId,
        media_path: input.key,
        type: input.type,
        product_id: input.productId ? Number(input.productId) : undefined,
        promotion_id: input.promotionId ? Number(input.promotionId) : undefined,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      include: STORY_INCLUDE,
    });
    return this.toJson(row);
  }

  /**
   * Vue idempotente par spectateur — `upsert` sur la contrainte unique
   * `(story_id, user_id)` : une vue répétée rafraîchit seulement `viewed_at`,
   * sans jamais gonfler le compte de spectateurs distincts.
   */
  async view(id: string, viewerMysqlId: number): Promise<{ viewed: true }> {
    const story = await this.prisma.stories.findFirst({ where: { id: Number(id), expires_at: { gt: new Date() } } });
    if (!story) throw AppError.notFound('Story');

    await this.prisma.story_views.upsert({
      where: { story_id_user_id: { story_id: Number(id), user_id: viewerMysqlId } },
      create: { story_id: Number(id), user_id: viewerMysqlId },
      update: { viewed_at: new Date() },
    });
    return { viewed: true };
  }

  /** Statistiques réservées à l'auteur — qui a consulté ma story. */
  async viewers(id: string, requesterMysqlId: number): Promise<{ viewCount: number; viewers: unknown[] }> {
    const story = await this.prisma.stories.findFirst({ where: { id: Number(id), user_id: requesterMysqlId } });
    if (!story) throw AppError.notFound('Story');

    const views = await this.prisma.story_views.findMany({
      where: { story_id: Number(id) },
      include: { users: { select: { firstname: true, lastname: true, avatar: true } } },
      orderBy: { viewed_at: 'desc' },
    });
    return {
      viewCount: views.length,
      viewers: views.map((v) => ({
        name: `${v.users.firstname} ${v.users.lastname}`.trim(),
        avatar: v.users.avatar ?? undefined,
        viewedAt: v.viewed_at,
      })),
    };
  }

  /** Bascule idempotente, même motif que `SocialService.toggleReaction` sur les publications. */
  async toggleReaction(userMysqlId: number, storyId: string, type = 'love'): Promise<{ reacted: boolean }> {
    const id = Number(storyId);
    const existing = await this.prisma.story_reactions.findUnique({
      where: { story_id_user_id: { story_id: id, user_id: userMysqlId } },
    });
    if (existing) {
      await this.prisma.story_reactions.delete({ where: { id: existing.id } });
      return { reacted: false };
    }
    await this.prisma.story_reactions.create({ data: { story_id: id, user_id: userMysqlId, type: type as never } });
    return { reacted: true };
  }

  /** Purge les stories expirées depuis plus de 7 jours (rétention, § décision confirmée). */
  async purgeExpired(): Promise<{ deleted: number }> {
    const threshold = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const result = await this.prisma.stories.deleteMany({ where: { expires_at: { lt: threshold } } });
    return { deleted: result.count };
  }

  private toJson(row: StoryRow): unknown {
    return {
      id: String(row.id),
      authorId: String(row.user_id),
      author: { name: `${row.users.firstname} ${row.users.lastname}`.trim(), avatar: row.users.avatar ?? undefined },
      media: { ...this.media.publicUrls(row.media_path), type: row.type },
      productId: row.product_id ? String(row.product_id) : undefined,
      promotionId: row.promotion_id ? String(row.promotion_id) : undefined,
      viewCount: row._count.story_views,
      reactionCount: row._count.story_reactions,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }
}
