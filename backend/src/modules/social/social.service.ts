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
import { NotificationsService } from '../notifications/notifications.service';

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
    private readonly notifications: NotificationsService,
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
    return this.paginate(rows, limit, viewerMysqlId);
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

  /** Publication isolée — pour ouvrir directement une publication depuis une notification. */
  async findOne(postId: string, viewerMysqlId?: number): Promise<unknown> {
    const row = await this.prisma.posts.findUnique({ where: { id: Number(postId) }, include: POST_INCLUDE });
    if (!row) throw AppError.notFound('Publication');

    let reactedByMe = false;
    if (viewerMysqlId) {
      const reaction = await this.prisma.reactions.findUnique({
        where: { post_id_user_id: { post_id: row.id, user_id: viewerMysqlId } },
      });
      reactedByMe = reaction != null;
    }
    return this.toJson(row, reactedByMe);
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

    // Notifie l'auteur — jamais soi-même (réagir à sa propre publication ne
    // doit pas générer de notification, même comportement que Facebook).
    const post = await this.prisma.posts.findUnique({ where: { id }, select: { user_id: true } });
    if (post && post.user_id !== userMysqlId) {
      const actor = await this.prisma.users.findUnique({
        where: { id: userMysqlId },
        select: { firstname: true, lastname: true },
      });
      const actorName = actor ? `${actor.firstname} ${actor.lastname}`.trim() : 'Quelqu’un';
      await this.notifications.create({
        userId: post.user_id,
        type: 'social.reaction',
        title: `${actorName} a aimé votre publication`,
        body: '',
        data: { screen: 'post', postId },
      });
    }
    return { reacted: true };
  }

  async comment(user: AuthenticatedUser, postId: string, content: string, parentId?: string): Promise<unknown> {
    if (!content.trim()) throw new AppError('COMMENT_EMPTY', 'Le commentaire ne peut pas être vide.', 400);
    const post = await this.prisma.posts.findUnique({ where: { id: Number(postId) } });
    if (!post) throw AppError.notFound('Publication');

    // `parent_id` existe en base (colonne partagée avec le site web) mais
    // n'était jusqu'ici jamais renseigné côté API — aucune réponse à un
    // commentaire précis n'était possible, seulement des commentaires à plat.
    let parent: { id: number; user_id: number } | null = null;
    if (parentId) {
      parent = await this.prisma.comments.findFirst({
        where: { id: Number(parentId), post_id: Number(postId) },
        select: { id: true, user_id: true },
      });
      if (!parent) throw AppError.notFound('Commentaire');
    }

    const comment = await this.prisma.comments.create({
      data: {
        post_id: Number(postId),
        user_id: user.mysqlId,
        content: content.trim(),
        parent_id: parent?.id,
      },
      include: { users: { select: { firstname: true, lastname: true, avatar: true } } },
    });

    const flagged = await this.moderation.autoModerate('comment', String(comment.id), content);
    const commenterName = `${comment.users.firstname} ${comment.users.lastname}`.trim();

    if (post.user_id !== user.mysqlId) {
      await this.notifications.create({
        userId: post.user_id,
        type: 'social.comment',
        title: `${commenterName} a commenté votre publication`,
        body: content.trim(),
        data: { screen: 'post', postId },
      });
    }
    // Réponse à quelqu'un d'autre que l'auteur du post (déjà notifié
    // ci-dessus) et pas à soi-même — comme Facebook, qui distingue « on a
    // commenté ma publication » de « on m'a répondu ».
    if (parent && parent.user_id !== user.mysqlId && parent.user_id !== post.user_id) {
      await this.notifications.create({
        userId: parent.user_id,
        type: 'social.comment_reply',
        title: `${commenterName} a répondu à votre commentaire`,
        body: content.trim(),
        data: { screen: 'post', postId },
      });
    }

    return {
      id: String(comment.id),
      userId: user.id,
      parentId: comment.parent_id ? String(comment.parent_id) : undefined,
      author: { name: commenterName, avatar: comment.users.avatar ?? undefined },
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
      userId: String(row.user_id),
      parentId: row.parent_id ? String(row.parent_id) : undefined,
      author: { name: `${row.users.firstname} ${row.users.lastname}`.trim(), avatar: row.users.avatar ?? undefined },
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  /**
   * Édition — réservée à l'auteur (même schéma que `update()` pour les
   * publications). Un commentaire déjà signalé reste modifiable : corriger un
   * mot maladroit est justement ce qui peut lever un signalement.
   */
  async editComment(userMysqlId: number, commentId: string, content: string): Promise<unknown> {
    if (!content.trim()) throw new AppError('COMMENT_EMPTY', 'Le commentaire ne peut pas être vide.', 400);

    const result = await this.prisma.comments.updateMany({
      where: { id: Number(commentId), user_id: userMysqlId },
      data: { content: content.trim() },
    });
    if (!result.count) throw AppError.notFound('Commentaire');

    const row = await this.prisma.comments.findUniqueOrThrow({
      where: { id: Number(commentId) },
      include: { users: { select: { firstname: true, lastname: true, avatar: true } } },
    });
    return {
      id: String(row.id),
      userId: String(row.user_id),
      author: { name: `${row.users.firstname} ${row.users.lastname}`.trim(), avatar: row.users.avatar ?? undefined },
      content: row.content,
      createdAt: row.created_at,
    };
  }

  /** Suppression — réservée à l'auteur, jamais une simple mise à drapeau ici : contrairement au signalement, l'auteur retire son propre mot. */
  async deleteComment(userMysqlId: number, commentId: string): Promise<{ deleted: true }> {
    const result = await this.prisma.comments.deleteMany({
      where: { id: Number(commentId), user_id: userMysqlId },
    });
    if (!result.count) throw AppError.notFound('Commentaire');
    return { deleted: true };
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

  private async paginate(rows: PostRow[], limit: number, viewerMysqlId?: number): Promise<Paginated<unknown>> {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Une seule requête groupée pour tous les posts de la page plutôt qu'un
    // aller-retour par post — sinon un post réagi hier redevient « non
    // réagi » à chaque relance de l'écran (le cœur ne restait jamais rempli).
    let reactedPostIds: Set<number> = new Set();
    if (viewerMysqlId && page.length > 0) {
      const reactions = await this.prisma.reactions.findMany({
        where: { user_id: viewerMysqlId, post_id: { in: page.map((row) => row.id) } },
        select: { post_id: true },
      });
      reactedPostIds = new Set(reactions.map((r) => r.post_id));
    }

    const items = await Promise.all(page.map((row) => this.toJson(row, reactedPostIds.has(row.id))));
    const last = page[page.length - 1];

    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last ? encodeCursor({ value: last.created_at!.toISOString(), id: String(last.id) }) : null,
    };
  }

  private toJson(row: PostRow, reactedByMe = false): unknown {
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
      reactedByMe,
      reported: row.reported,
      reportReason: row.report_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
