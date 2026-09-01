import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import {
  Comment,
  type CommentDocument,
  Reaction,
  type ReactionDocument,
} from './schemas/interactions.schema';
import { Post, type PostDocument } from './schemas/post.schema';

@Injectable()
export class SocialService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<PostDocument>,
    @InjectModel(Comment.name) private readonly comments: Model<CommentDocument>,
    @InjectModel(Reaction.name) private readonly reactions: Model<ReactionDocument>,
  ) {}

  async feed(limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { visibility: 'public' };
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
    const post = await this.posts.create({
      authorId: new Types.ObjectId(user.id),
      author: { name: user.phone, type: 'user' },
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
    return post.toJSON();
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
    return comment.toJSON();
  }

  async commentsFor(postId: string, limit: number): Promise<unknown[]> {
    return this.comments.find({ postId }).sort({ createdAt: 1 }).limit(limit).lean();
  }
}
