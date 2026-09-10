import { Module } from '@nestjs/common';

import { MediaModule } from '../media/media.module';
import { ModerationModule } from '../moderation/moderation.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { StoriesCleanupService } from './stories-cleanup.service';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

/**
 * Fil social, publications, favoris, stories — `posts`/`comments`/
 * `reactions`/`favorites`/`shop_favorites`/`saved_promotions`/`saved_posts`/
 * `stories`/`story_views`/`story_reactions` sont toutes des tables MySQL
 * réelles depuis la Phase 4. 100 % MySQL depuis la bascule d'identité
 * (Phase 6) — plus besoin d'`AuthModule`.
 */
@Module({
  imports: [MediaModule, ModerationModule],
  controllers: [FavoritesController, FollowsController, SocialController, StoriesController],
  providers: [FavoritesService, FollowsService, SocialService, StoriesService, StoriesCleanupService],
})
export class SocialModule {}
