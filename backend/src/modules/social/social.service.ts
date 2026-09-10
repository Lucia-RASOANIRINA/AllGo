import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { decodeCursor, encodeCursor, prismaCursorFilter } from '../../common/pagination/cursor';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { Role } from '../../common/rbac/roles';
import { ModerationService } from '../moderation/moderation.service';
import type { ReportReasonCode } from '../moderation/schemas/report.schema';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MediaService } from '../media/media.service';

/** Rôles autorisés à publier « en tant que » la boutique plutôt qu'en leur nom propre. */
const SHOP_POST_ROLES: readonly string[] = [Role.ShopOwner, Role.ShopManager, Role.ShopMarketing];

const POST_INCLUDE = {
  users: { select: { firstname: true, lastname: true, avatar: true } },
  shops: { select: { id: true, name: true, logo: true } },
  products: { select: { id: true, name: true, price: true, promo_price: true } },
  post_media: true,
  _count: { select: { reactions: true, comments: true, shares: true } },
} satisfies Prisma.postsInclude;

type PostRow = Prisma.postsGetPayload<{ include: typeof POST_INCLUDE }>;

/**
 * Réseau social — `posts`/`comments`/`reactions`/`post_media`/`shares` sont
 * des tables réelles depuis la Phase 4. 100 % MySQL depuis la bascule
 * d'identité (Phase 6).
 */
@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly media: MediaService,
  ) {}

  async feed(limit: number, cursor: string | undefined, viewerMysqlId?: number): Promise<Paginated<unknown>> {
    const where: Prisma.postsWhereInput = { visibility: 'public', reported: false };
    if (viewerMysqlId) {
      const blocked = await this.moderation.blockedAuthorIds(viewerMysqlId);
      if (blocked.length > 0) where.user_id = { notIn: blocked };
    }
    if (cursor) Object.assign(where, prismaCursorFilter('created_at', decodeCursor(cursor)));

    const rows = await this.prisma.posts.findMany({
      where,
      include: POST_INCLUDE,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return this.paginate(rows, limit);
  }

  async create(user: AuthenticatedUser, input: {
    content?: string;
    media?: Array<{ url: string; type: string; thumbUrl?: string; previewUrl?: string }>;
    productId?: string;
    promotionId?: string;
    shopId?: string;
    visibility?: 'public' | 'followers';
  }): Promise<unknown> {
    if (!input.content?.trim() && (!input.media || input.media.length === 0) && !input.productId) {
      throw new AppError('POST_EMPTY', 'Une publication doit contenir un texte, une image ou un produit.', 400);
    }

    // `shopId` fait publier « en tant que » la boutique — sans lui, l'auteur
    // reste la personne elle-même. C'était jusqu'ici la SEULE issue possible :
    // `author.type` valait toujours `'user'`, même pour un commerçant, ce qui
    // rendait `ShopsService.postsFor()` (l'onglet Publications d'une fiche
    // boutique) structurellement vide — aucune publication réelle ne pouvait
    // jamais porter `author.type: 'shop'` (§22).
    if (input.shopId) await this.assertShopPostRole(user, input.shopId);

    const post = await this.prisma.posts.create({
      data: {
        user_id: user.mysqlId,
        shop_id: input.shopId ? Number(input.shopId) : undefined,
        content: input.content?.trim(),
        product_id: input.productId ? Number(input.productId) : undefined,
        promotion_id: input.promotionId ? Number(input.promotionId) : undefined,
        visibility: input.visibility ?? 'public',
        post_media: input.media?.length
          ? { create: input.media.map((m) => ({ type: m.type as never, file_path: m.url })) }
          : undefined,
      },
      include: POST_INCLUDE,
    });

    const flagged = await this.moderation.autoModerate('post', String(post.id), input.content);
    if (flagged) {
      post.reported = flagged.reported;
      post.report_reason = flagged.reportReason;
    }
    return this.toJson(post);
  }

  private async assertShopPostRole(user: AuthenticatedUser, shopId: string): Promise<void> {
    const hasRole = user.roles.some(
      (assignment) => SHOP_POST_ROLES.includes(assignment.role) && String(assignment.shopId) === shopId,
    );
    if (!hasRole) {
      throw new AppError('FORBIDDEN_SHOP_POST', 'Vous ne gérez pas cette boutique.', 403);
    }
    const shop = await this.prisma.shops.findUnique({ where: { id: Number(shopId) } });
    if (!shop) throw AppError.notFound('Boutique');
  }

  async update(userMysqlId: number, postId: string, input: {
    content?: string; media?: Array<{ url: string; type: string }>; productId?: string; promotionId?: string;
  }): Promise<unknown> {
    const result = await this.prisma.posts.updateMany({
      where: { id: Number(postId), user_id: userMysqlId },
      data: {
        content: input.content,
        product_id: input.productId ? Number(input.productId) : undefined,
        promotion_id: input.promotionId ? Number(input.promotionId) : undefined,
      },
    });
    if (!result.count) throw AppError.notFound('Publication');

    if (input.media) {
      await this.prisma.$transaction([
        this.prisma.post_media.deleteMany({ where: { post_id: Number(postId) } }),
        this.prisma.post_media.createMany({
          data: input.media.map((m) => ({ post_id: Number(postId), type: m.type as never, file_path: m.url })),
        }),
      ]);
    }

    const post = await this.prisma.posts.findUnique({ where: { id: Number(postId) }, include: POST_INCLUDE });
    return this.toJson(post!);
  }

  async remove(userMysqlId: number, postId: string): Promise<{ deleted: true }> {
    const result = await this.prisma.posts.deleteMany({ where: { id: Number(postId), user_id: userMysqlId } });
    if (!result.count) throw AppError.notFound('Publication');
    return { deleted: true };
  }

  async toggleReaction(userMysqlId: number, postId: string, type = 'like'): Promise<{ reacted: boolean }> {
    const id = Number(postId);
    const existing = await this.prisma.reactions.findUnique({
      where: { post_id_user_id: { post_id: id, user_id: userMysqlId } },
    });
    if (existing) {
      await this.prisma.reactions.delete({ where: { id: existing.id } });
      return { reacted: false };
    }
    await this.prisma.reactions.create({ data: { post_id: id, user_id: userMysqlId, type: type as never } });
    return { reacted: true };
  }

  async comment(user: AuthenticatedUser, postId: string, content: string): Promise<unknown> {
    if (!content.trim()) throw new AppError('COMMENT_EMPTY', 'Le commentaire ne peut pas être vide.', 400);
    const post = await this.prisma.posts.findUnique({ where: { id: Number(postId) } });
    if (!post) throw AppError.notFound('Publication');

    const comment = await this.prisma.comments.create({
      data: { post_id: Number(postId), user_id: user.mysqlId, content: content.trim() },
      include: { users: { select: { firstname: true, lastname: true, avatar: true } } },
    });

    const flagged = await this.moderation.autoModerate('comment', String(comment.id), content);
    return {
      id: String(comment.id),
      userId: user.id,
      author: { name: `${comment.users.firstname} ${comment.users.lastname}`.trim(), avatar: comment.users.avatar ?? undefined },
      content: comment.content,
      reported: flagged?.reported ?? false,
      createdAt: comment.created_at,
    };
  }

  async commentsFor(postId: string, limit: number): Promise<unknown[]> {
    const rows = await this.prisma.comments.findMany({
      where: { post_id: Number(postId), reported: false },
      include: { users: { select: { firstname: true, lastname: true, avatar: true } } },
      orderBy: { created_at: 'asc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: String(row.id),
      author: { name: `${row.users.firstname} ${row.users.lastname}`.trim(), avatar: row.users.avatar ?? undefined },
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  /**
   * Partage — compteur seul (§11). Un partage recopie un lien ou republie
   * ailleurs ; l'application ne modélise pas de republication interne, donc
   * il n'y a rien d'autre à persister qu'une trace de l'intention. Pas de
   * déduplication : un même utilisateur peut partager plusieurs fois (déjà
   * le comportement avant la migration).
   */
  async share(postId: string, userMysqlId: number): Promise<{ shares: number }> {
    const post = await this.prisma.posts.findUnique({ where: { id: Number(postId) } });
    if (!post) throw AppError.notFound('Publication');
    await this.prisma.shares.create({ data: { post_id: Number(postId), user_id: userMysqlId } });
    const shares = await this.prisma.shares.count({ where: { post_id: Number(postId) } });
    return { shares };
  }

  /**
   * Signalement — pose le drapeau (même motif que `ReviewsService.report` :
   * jamais une suppression) ET dépose une entrée dans la file de modération
   * unifiée (§29), avec l'identité du signalant.
   */
  async report(reporterMysqlId: number, postId: string, reason?: string, reasonCode?: ReportReasonCode): Promise<{ reported: true }> {
    const result = await this.prisma.posts.updateMany({
      where: { id: Number(postId) },
      data: { reported: true, report_reason: reason },
    });
    if (!result.count) throw AppError.notFound('Publication');
    await this.moderation.fileReport({ reporterId: reporterMysqlId, targetType: 'post', targetId: postId, reason, reasonCode });
    return { reported: true };
  }

  async reportComment(reporterMysqlId: number, commentId: string, reason?: string, reasonCode?: ReportReasonCode): Promise<{ reported: true }> {
    const result = await this.prisma.comments.updateMany({
      where: { id: Number(commentId) },
      data: { reported: true, report_reason: reason },
    });
    if (!result.count) throw AppError.notFound('Commentaire');
    await this.moderation.fileReport({ reporterId: reporterMysqlId, targetType: 'comment', targetId: commentId, reason, reasonCode });
    return { reported: true };
  }

  private async paginate(rows: PostRow[], limit: number): Promise<Paginated<unknown>> {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = await Promise.all(page.map((row) => this.toJson(row)));
    const last = page[page.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ value: last.created_at!.toISOString(), id: String(last.id) }) : null,
    };
  }

  private toJson(row: PostRow): unknown {
    const authorMirrorId = String(row.user_id);
    const isShopAuthor = row.shop_id != null && row.shops;

    return {
      id: String(row.id),
      authorId: authorMirrorId,
      author: isShopAuthor
        ? { name: row.shops!.name, avatar: row.shops!.logo ?? undefined, type: 'shop' as const, shopId: String(row.shop_id) }
        : { name: `${row.users.firstname} ${row.users.lastname}`.trim(), avatar: row.users.avatar ?? undefined, type: 'user' as const },
      content: row.content ?? undefined,
      media: row.post_media.map((m) => ({ ...this.media.publicUrls(m.file_path), type: m.type })),
      productId: row.product_id ? String(row.product_id) : undefined,
      promotionId: row.promotion_id ? String(row.promotion_id) : undefined,
      product: row.products
        ? { name: row.products.name, price: row.products.price, promoPrice: row.products.promo_price ?? undefined }
        : undefined,
      shopId: row.shop_id ? String(row.shop_id) : undefined,
      visibility: row.visibility,
      counters: { reactions: row._count.reactions, comments: row._count.comments, shares: row._count.shares, views: 0 },
      reported: row.reported,
      reportReason: row.report_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
