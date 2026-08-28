import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { Paginated } from '../../common/http/response.interceptor';
import { cursorFilter, decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import {
  Comment,
  type CommentDocument,
  Reaction,
  type ReactionDocument,
} from './schemas/interactions.schema';
import { Post, type PostDocument } from './schemas/post.schema';

/**
 * Publications d'une boutique — lecture et interaction (réactions,
 * commentaires) uniquement. Aucune création : publier pour une boutique est
 * un geste commerçant, porté par l'espace `/bord` (lot L5, non livré), hors
 * du périmètre client de ce module.
 */
@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<PostDocument>,
    @InjectModel(Comment.name) private readonly comments: Model<CommentDocument>,
    @InjectModel(Reaction.name) private readonly reactions: Model<ReactionDocument>,
  ) {}

  async listByShop(shopId: string, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = {
      'author.type': 'shop',
      'author.shopId': new Types.ObjectId(shopId),
    };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor)));

    const docs = await this.posts
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

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

  /** Bascule idempotente — un « like » par utilisateur et par publication (index unique). */
  async react(postId: string, userId: string, type: string): Promise<{ reacted: true }> {
    const result = await this.reactions.updateOne(
      {
        targetType: 'post',
        targetId: new Types.ObjectId(postId),
        userId: new Types.ObjectId(userId),
      },
      { $setOnInsert: { type, createdAt: new Date() } },
      { upsert: true },
    );
    if (result.upsertedCount > 0) {
      await this.posts.updateOne({ _id: postId }, { $inc: { 'counters.reactions': 1 } });
    }
    return { reacted: true };
  }

  async unreact(postId: string, userId: string): Promise<{ reacted: false }> {
    const result = await this.reactions.deleteOne({
      targetType: 'post',
      targetId: new Types.ObjectId(postId),
      userId: new Types.ObjectId(userId),
    });
    if (result.deletedCount > 0) {
      await this.posts.updateOne(
        { _id: postId, 'counters.reactions': { $gt: 0 } },
        { $inc: { 'counters.reactions': -1 } },
      );
    }
    return { reacted: false };
  }

  async listComments(postId: string, limit: number, cursor?: string): Promise<Paginated<unknown>> {
    const filter: Record<string, unknown> = { postId: new Types.ObjectId(postId) };
    if (cursor) Object.assign(filter, cursorFilter('createdAt', decodeCursor(cursor), 'asc'));

    const docs = await this.comments
      .find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean();

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

  async addComment(
    postId: string,
    userId: string,
    author: { name: string; avatar?: string },
    content: string,
  ): Promise<unknown> {
    const post = await this.posts.findById(postId).select('_id').lean();
    if (!post) throw AppError.notFound('Publication');

    const comment = await this.comments.create({
      postId: new Types.ObjectId(postId),
      userId: new Types.ObjectId(userId),
      author,
      content,
    });
    await this.posts.updateOne({ _id: postId }, { $inc: { 'counters.comments': 1 } });
    return comment.toJSON();
  }
}
