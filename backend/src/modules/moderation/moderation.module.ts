import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Comment, CommentSchema } from '../social/schemas/interactions.schema';
import { Post, PostSchema } from '../social/schemas/post.schema';
import { Product, ProductSchema } from '../catalog/schemas/product.schema';
import { Shop, ShopSchema } from '../shops/schemas/shop.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { BannedWord, BannedWordSchema } from './schemas/banned-word.schema';
import { Report, ReportSchema } from './schemas/report.schema';
import { Sanction, SanctionSchema } from './schemas/sanction.schema';
import { UserBlock, UserBlockSchema } from './schemas/user-block.schema';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

/**
 * Enregistre à nouveau les schémas `Post`/`Comment`/`Product`/`Shop`/`User`
 * plutôt que d'importer `SocialModule`/`CatalogModule`/`ShopsModule`/
 * `UsersModule` en entier — même motif que `AdministrationModule` (§28) :
 * Mongoose autorise plusieurs modules à enregistrer le même schéma sur la
 * même collection, et cela évite toute dépendance circulaire avec
 * `SocialModule`/`MessagingModule`, qui importent CE module pour la
 * modération automatique et le blocage.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Report.name, schema: ReportSchema },
      { name: Sanction.name, schema: SanctionSchema },
      { name: UserBlock.name, schema: UserBlockSchema },
      { name: BannedWord.name, schema: BannedWordSchema },
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Shop.name, schema: ShopSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
