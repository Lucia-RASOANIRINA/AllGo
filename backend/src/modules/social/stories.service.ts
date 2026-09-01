import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { Story, type StoryDocument } from './schemas/story.schema';

@Injectable()
export class StoriesService {
  constructor(@InjectModel(Story.name) private readonly stories: Model<StoryDocument>) {}

  list(): Promise<unknown[]> {
    return this.stories.find({ expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).limit(100).lean();
  }

  async create(user: AuthenticatedUser, media: { url: string; type: 'image' | 'video' }): Promise<unknown> {
    const story = await this.stories.create({
      authorId: new Types.ObjectId(user.id),
      author: { name: user.phone },
      media,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      viewCount: 0,
    });
    return story.toJSON();
  }

  async view(id: string): Promise<{ viewed: true }> {
    const result = await this.stories.updateOne(
      { _id: id, expiresAt: { $gt: new Date() } },
      { $inc: { viewCount: 1 } },
    );
    if (result.matchedCount === 0) throw AppError.notFound('Story');
    return { viewed: true };
  }
}
