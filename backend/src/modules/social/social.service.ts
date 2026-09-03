import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { Role } from '../../common/rbac/roles';
import { ModerationService } from '../moderation/moderation.service';
import type { ReportReasonCode } from '../moderation/schemas/report.schema';
import { Shop, type ShopDocument } from '../shops/schemas/shop.schema';
import {
  Comment,
  type CommentDocument,
  Reaction,
  type ReactionDocument,
} from './schemas/interactions.schema';
import { Post, type PostDocument } from './schemas/post.schema';

/** Rôles autorisés à publier « en tant que » la boutique plutôt qu'en leur nom propre. */
const SHOP_POST_ROLES: readonly string[] = [Role.ShopOwner, Role.ShopManager, Role.ShopMarketing];

@Injectable()
export class SocialService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<PostDocument>,
    @InjectModel(Comment.name) private readonly comments: Model<CommentDocument>,
    @InjectModel(Reaction.name) private readonly reactions: Model<ReactionDocument>,
    @InjectModel(Shop.name) private readonly shops: Model<ShopDocument>,
    private readonly moderation: ModerationService,
  ) {}

  async feed(limit: number, cursor?: string, viewerId?: string): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { visibility: 'public', reported: { $ne: true } };
    if (viewerId) {
      const blocked = await this.moderation.blockedAuthorIds(viewerId);
      if (blocked.length > 0) filter.authorId = { $nin: blocked };
    }
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));
    const docs = await this.posts.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;
    const last = items[items.length - 1];
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodeCursor({ value: last.createdAt.toISOString(), id: String(last._id) })
          : null,
    };
  }

  async create(user: AuthenticatedUser, input: {
    content?: string;
    media?: Array<{ url: string; type: string; thumbUrl?: string; previewUrl?: string }>;
    productId?: string;
    promotionId?: string;
    shopId?: string;
    scheduledAt?: string;
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
    const author = input.shopId
      ? await this.resolveShopAuthor(user, input.shopId)
      : { name: user.phone, type: 'user' as const };

    const post = await this.posts.create({
      authorId: new Types.ObjectId(user.id),
      author,
      kind: 'post',
      content: input.content?.trim(),
      media: input.media ?? [],
      productId: input.productId ? new Types.ObjectId(input.productId) : undefined,
      promotionId: input.promotionId ? new Types.ObjectId(input.promotionId) : undefined,
      shopId: input.shopId ? new Types.ObjectId(input.shopId) : undefined,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
      visibility: input.visibility ?? 'public',
      counters: { reactions: 0, comments: 0, shares: 0, views: 0 },
    });
    const flagged = await this.moderation.autoModerate('post', String(post._id), input.content);
    if (flagged) {
      post.reported = flagged.reported;
      post.reportReason = flagged.reportReason;
    }
    return post.toJSON();
  }

  private async resolveShopAuthor(
    user: AuthenticatedUser,
    shopId: string,
  ): Promise<{ name: string; avatar?: string; type: 'shop'; shopId: Types.ObjectId }> {
    const hasRole = user.roles.some(
      (assignment) => SHOP_POST_ROLES.includes(assignment.role) && String(assignment.shopId) === shopId,
    );
    if (!hasRole) {
      throw new AppError('FORBIDDEN_SHOP_POST', 'Vous ne gérez pas cette boutique.', 403);
    }
    const shop = await this.shops.findById(shopId).select('name logo').lean();
    if (!shop) throw AppError.notFound('Boutique');
    return { name: shop.name, avatar: shop.logo, type: 'shop', shopId: new Types.ObjectId(shopId) };
  }

  async update(userId: string, postId: string, input: {
    content?: string; media?: Array<{ url: string; type: string }>; productId?: string;
    promotionId?: string; scheduledAt?: string;
  }) {
    const post = await this.posts.findOneAndUpdate(
      { _id: postId, authorId: new Types.ObjectId(userId) },
      { $set: { ...input, productId: input.productId ? new Types.ObjectId(input.productId) : undefined, promotionId: input.promotionId ? new Types.ObjectId(input.promotionId) : undefined, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined } },
      { new: true, runValidators: true },
    );
    if (!post) throw AppError.notFound('Publication');
    return post.toJSON();
  }

  async remove(userId: string, postId: string) {
    const result = await this.posts.deleteOne({ _id: postId, authorId: new Types.ObjectId(userId) });
    if (!result.deletedCount) throw AppError.notFound('Publication');
    return { deleted: true };
  }

  async toggleReaction(userId: string, postId: string, type = 'like'): Promise<{ reacted: boolean }> {
    const targetId = new Types.ObjectId(postId);
    const filter = { targetType: 'post' as const, targetId, userId: new Types.ObjectId(userId) };
    const existing = await this.reactions.findOne(filter);
    if (existing) {
      await this.reactions.deleteOne({ _id: existing._id });
      await this.posts.updateOne({ _id: targetId }, { $inc: { 'counters.reactions': -1 } });
      return { reacted: false };
    }
    await this.reactions.create({ ...filter, type });
    await this.posts.updateOne({ _id: targetId }, { $inc: { 'counters.reactions': 1 } });
    return { reacted: true };
  }

  async comment(user: AuthenticatedUser, postId: string, content: string): Promise<unknown> {
    if (!content.trim()) throw new AppError('COMMENT_EMPTY', 'Le commentaire ne peut pas être vide.', 400);
    const post = await this.posts.exists({ _id: postId });
    if (!post) throw AppError.notFound('Publication');
    const comment = await this.comments.create({
      postId: new Types.ObjectId(postId),
      userId: new Types.ObjectId(user.id),
      author: { name: user.phone },
      content: content.trim(),
      parentId: null,
    });
    await this.posts.updateOne({ _id: postId }, { $inc: { 'counters.comments': 1 } });
    const flagged = await this.moderation.autoModerate('comment', String(comment._id), content);
    if (flagged) {
      comment.reported = flagged.reported;
      comment.reportReason = flagged.reportReason;
    }
    return comment.toJSON();
  }

  async commentsFor(postId: string, limit: number): Promise<unknown[]> {
    return this.comments.find({ postId, reported: { $ne: true } }).sort({ createdAt: 1 }).limit(limit).lean();
  }

  /**
   * Partage — compteur seul (§11). Un partage recopie un lien ou republie
   * ailleurs ; l'application ne modélise pas de republication interne, donc
   * il n'y a rien d'autre à persister qu'une trace de l'intention.
   */
  async share(postId: string): Promise<{ shares: number }> {
    const post = await this.posts.findOneAndUpdate(
      { _id: postId },
      { $inc: { 'counters.shares': 1 } },
      { new: true },
    );
    if (!post) throw AppError.notFound('Publication');
    return { shares: post.counters.shares };
  }

  /**
   * Signalement — pose le drapeau (même motif que `ReviewsService.report` :
   * jamais une suppression) ET dépose une entrée dans la file de modération
   * unifiée (§29), avec l'identité du signalant — ce que le drapeau seul ne
   * conservait pas.
   */
  async report(userId: string, postId: string, reason?: string, reasonCode?: ReportReasonCode): Promise<{ reported: true }> {
    const result = await this.posts.updateOne(
      { _id: postId },
      { $set: { reported: true, reportReason: reason } },
    );
    if (!result.matchedCount) throw AppError.notFound('Publication');
    await this.moderation.fileReport({ reporterId: userId, targetType: 'post', targetId: postId, reason, reasonCode });
    return { reported: true };
  }

  async reportComment(userId: string, commentId: string, reason?: string, reasonCode?: ReportReasonCode): Promise<{ reported: true }> {
    const result = await this.comments.updateOne(
      { _id: commentId },
      { $set: { reported: true, reportReason: reason } },
    );
    if (!result.matchedCount) throw AppError.notFound('Commentaire');
    await this.moderation.fileReport({ reporterId: userId, targetType: 'comment', targetId: commentId, reason, reasonCode });
    return { reported: true };
  }
}
