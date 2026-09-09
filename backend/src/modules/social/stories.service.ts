import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { MediaService } from '../media/media.service';
import { Story, type StoryDocument } from './schemas/story.schema';
import { Reaction, type ReactionDocument } from './schemas/interactions.schema';

@Injectable()
export class StoriesService {
  constructor(
    @InjectModel(Story.name) private readonly stories: Model<StoryDocument>,
    @InjectModel(Reaction.name) private readonly reactions: Model<ReactionDocument>,
    private readonly media: MediaService,
  ) {}

  list(): Promise<unknown[]> {
    return this.stories
      .find({ expiresAt: { $gt: new Date() } })
      .select('-viewers')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
  }

  async create(
    user: AuthenticatedUser,
    input: { key: string; type: 'image' | 'video'; productId?: string; promotionId?: string },
  ): Promise<unknown> {
    // Même contrat que l'avatar de profil (`UsersService.updateProfile`) :
    // le client envoie la clé S3 issue de `/media/upload-url`, jamais une URL
    // qu'il aurait dû reconstruire lui-même à partir de `s3.publicBaseUrl`.
    const url = this.media.publicUrls(input.key).url;
    const story = await this.stories.create({
      authorId: new Types.ObjectId(user.id),
      author: { name: user.phone },
      media: { url, type: input.type },
      productId: input.productId ? new Types.ObjectId(input.productId) : undefined,
      promotionId: input.promotionId ? new Types.ObjectId(input.promotionId) : undefined,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      viewCount: 0,
    });
    return story.toJSON();
  }

  /**
   * Vue idempotente par spectateur : la première vue incrémente `viewCount`
   * et ajoute l'entrée ; une vue répétée ne fait que rafraîchir `viewedAt`,
   * sans gonfler ni le compteur ni la liste.
   */
  async view(id: string, viewer: { id: string; name: string; avatar?: string }): Promise<{ viewed: true }> {
    const viewerId = new Types.ObjectId(viewer.id);
    const now = new Date();

    const alreadySeen = await this.stories.updateOne(
      { _id: id, expiresAt: { $gt: now }, 'viewers.userId': viewerId },
      { $set: { 'viewers.$.viewedAt': now } },
    );
    if (alreadySeen.matchedCount > 0) return { viewed: true };

    const result = await this.stories.updateOne(
      { _id: id, expiresAt: { $gt: now } },
      {
        $inc: { viewCount: 1 },
        $push: { viewers: { userId: viewerId, name: viewer.name, avatar: viewer.avatar, viewedAt: now } },
      },
    );
    if (result.matchedCount === 0) throw AppError.notFound('Story');
    return { viewed: true };
  }

  /** Statistiques réservées à l'auteur — qui a consulté ma story. */
  async viewers(id: string, requesterId: string): Promise<{ viewCount: number; viewers: unknown[] }> {
    const story = await this.stories
      .findOne({ _id: id, authorId: new Types.ObjectId(requesterId) })
      .select('viewCount viewers')
      .lean();
    if (!story) throw AppError.notFound('Story');
    return { viewCount: story.viewCount, viewers: story.viewers };
  }

  /** Bascule idempotente, même motif que `SocialService.toggleReaction` sur les publications. */
  async toggleReaction(userId: string, storyId: string, type = 'like'): Promise<{ reacted: boolean }> {
    const targetId = new Types.ObjectId(storyId);
    const filter = { targetType: 'story' as const, targetId, userId: new Types.ObjectId(userId) };
    const existing = await this.reactions.findOne(filter);
    if (existing) {
      await this.reactions.deleteOne({ _id: existing._id });
      await this.stories.updateOne({ _id: targetId }, { $inc: { reactionCount: -1 } });
      return { reacted: false };
    }
    await this.reactions.create({ ...filter, type });
    await this.stories.updateOne({ _id: targetId }, { $inc: { reactionCount: 1 } });
    return { reacted: true };
  }
}
