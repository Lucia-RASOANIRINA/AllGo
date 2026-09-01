import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  Comment,
  CommentSchema,
  Favorite,
  FavoriteSchema,
  Follow,
  FollowSchema,
  Reaction,
  ReactionSchema,
} from './schemas/interactions.schema';
import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { Post, PostSchema } from './schemas/post.schema';
import { Story, StorySchema } from './schemas/story.schema';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

/**
 * Fil social, publications, demandes clients, stories — lot **L3**.
 *
 * Les schémas sont déclarés dès le lot L0 : les index (`2dsphere`, TTL sur les
 * stories, uniques composés sur les réactions et les abonnements) sont créés au
 * démarrage, et l'outillage de migration M3 peut écrire dans des collections
 * déjà correctement indexées.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Reaction.name, schema: ReactionSchema },
      { name: Follow.name, schema: FollowSchema },
      { name: Favorite.name, schema: FavoriteSchema },
      { name: Story.name, schema: StorySchema },
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  controllers: [FavoritesController, SocialController, StoriesController],
  providers: [FavoritesService, SocialService, StoriesService],
  exports: [MongooseModule],
})
export class SocialModule {}
