import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { ModerationModule } from '../moderation/moderation.module';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';

/**
 * Fil social, publications, favoris, stories — `posts`/`comments`/
 * `reactions`/`favorites`/`shop_favorites`/`saved_promotions`/`saved_posts`/
 * `stories`/`story_views`/`story_reactions` sont toutes des tables MySQL
 * réelles depuis la Phase 4 : plus aucun schéma Mongoose à enregistrer ici.
 * `AuthModule` fournit `resolveMirrorId()`, nécessaire pour exposer
 * `authorId` au format attendu par le mobile tant que la session courante
 * n'a pas basculé sur l'entier MySQL direct (Phase 6).
 */
@Module({
  imports: [AuthModule, MediaModule, ModerationModule],
  controllers: [FavoritesController, FollowsController, SocialController, StoriesController],
  providers: [FavoritesService, FollowsService, SocialService, StoriesService],
})
export class SocialModule {}
