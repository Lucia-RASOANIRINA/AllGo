import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { User, UserSchema } from '../users/schemas/user.schema';
import { AuthModule } from '../auth/auth.module';
import { BannedWord, BannedWordSchema } from './schemas/banned-word.schema';
import { Report, ReportSchema } from './schemas/report.schema';
import { Sanction, SanctionSchema } from './schemas/sanction.schema';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

/**
 * Enregistre à nouveau le schéma `User` plutôt que d'importer `UsersModule`
 * en entier — même motif que `AdministrationModule` (§28) : Mongoose
 * autorise plusieurs modules à enregistrer le même schéma sur la même
 * collection, et cela évite toute dépendance circulaire avec
 * `SocialModule`/`MessagingModule`, qui importent CE module pour la
 * modération automatique et le blocage.
 *
 * `Product`/`Shop` (Phase 2) et `Post`/`Comment`/`UserBlock` (Phase 4) ont
 * migré vers MySQL : `ModerationService` les lit désormais via
 * `PrismaService` (`@Global()`), plus besoin de les enregistrer ici.
 * `AuthModule` fournit `resolveMysqlId()`, utilisé par le contrôleur pour
 * traduire l'ObjectId miroir d'une cible de blocage/signalement vers son
 * entier MySQL réel.
 */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Report.name, schema: ReportSchema },
      { name: Sanction.name, schema: SanctionSchema },
      { name: BannedWord.name, schema: BannedWordSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
