import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AppError } from '../../common/http/app-error';
import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuthService } from '../auth/auth.service';
import { CreateBannedWordDto, IssueSanctionDto, ReportDto, ResolveReportDto } from './dto/moderation.dto';
import { ModerationService } from './moderation.service';
import type { ReportStatus, ReportTargetType } from './schemas/report.schema';

@ApiTags('Modération')
@Controller('moderation')
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Le mobile envoie encore l'ObjectId du miroir pour désigner un AUTRE
   * utilisateur (`post.authorId`, `Participant.userId`...) tant que
   * `AuthenticatedUser.id` (session courante) n'a pas basculé sur l'entier
   * MySQL direct (Phase 6) — résolu ici vers `users.id` réel, seule forme
   * que `ModerationService`/`prisma.user_blocks` acceptent.
   */
  private async resolveTargetMysqlId(mirrorId: string): Promise<number> {
    const mysqlId = await this.auth.resolveMysqlId(mirrorId);
    if (!mysqlId) throw AppError.notFound('Utilisateur');
    return mysqlId;
  }

  // --- Signalements — utilisateur, boutique, produit (publication et commentaire : voir SocialController) ---

  @Post('users/:id/report')
  @RequirePermission(Permission.UserReport)
  reportUser(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReportDto) {
    return this.moderation.fileReport({ reporterId: user.id, targetType: 'user', targetId: id, ...dto });
  }

  @Post('shops/:id/report')
  @RequirePermission(Permission.ShopReport)
  reportShop(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReportDto) {
    return this.moderation.fileReport({ reporterId: user.id, targetType: 'shop', targetId: id, ...dto });
  }

  @Post('products/:id/report')
  @RequirePermission(Permission.ProductReport)
  reportProduct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReportDto) {
    return this.moderation.fileReport({ reporterId: user.id, targetType: 'product', targetId: id, ...dto });
  }

  // --- Blocage compte-à-compte ---

  @Post('users/:id/block')
  @RequirePermission(Permission.UserBlock)
  async block(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const blockedId = await this.resolveTargetMysqlId(id);
    return this.moderation.blockUser(user.mysqlId, blockedId);
  }

  @Delete('users/:id/block')
  @RequirePermission(Permission.UserBlock)
  async unblock(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const blockedId = await this.resolveTargetMysqlId(id);
    return this.moderation.unblockUser(user.mysqlId, blockedId);
  }

  @Get('blocked-users')
  @RequirePermission(Permission.ProfileRead)
  async blockedUsers(@CurrentUser() user: AuthenticatedUser) {
    const rows = await this.moderation.listBlockedUsers(user.mysqlId);
    // Reconverti au format miroir : c'est cet id que le mobile renverra tel
    // quel à `DELETE /moderation/users/:id/block` pour débloquer.
    return Promise.all(
      rows.map(async (row) => ({
        id: (await this.auth.resolveMirrorId(row.blocked_id)) ?? String(row.blocked_id),
        name: `${row.users_user_blocks_blocked_idTousers.firstname} ${row.users_user_blocks_blocked_idTousers.lastname}`.trim(),
        avatar: row.users_user_blocks_blocked_idTousers.avatar ?? undefined,
        createdAt: row.created_at,
      })),
    );
  }

  // --- Historique des sanctions ---

  @Get('sanctions/me')
  @RequirePermission(Permission.ProfileRead)
  mySanctions(@CurrentUser() user: AuthenticatedUser) {
    return this.moderation.sanctionsFor(user.id);
  }

  @Get('sanctions')
  @RequirePermission(Permission.PlatformModerate)
  sanctionsFor(@Query('userId') userId: string) {
    return this.moderation.sanctionsFor(userId);
  }

  @Post('sanctions')
  @RequirePermission(Permission.PlatformModerate)
  issueSanction(@CurrentUser() user: AuthenticatedUser, @Body() dto: IssueSanctionDto) {
    return this.moderation.sanctionUser({
      userId: dto.userId,
      type: dto.type,
      reason: dto.reason,
      issuedBy: user.id,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });
  }

  // --- File de modération (admin) ---

  @Get('reports')
  @RequirePermission(Permission.PlatformModerate)
  reports(@Query('status') status?: ReportStatus, @Query('targetType') targetType?: ReportTargetType) {
    return this.moderation.listReports(status, targetType);
  }

  @Patch('reports/:id')
  @RequirePermission(Permission.PlatformModerate)
  resolveReport(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ResolveReportDto) {
    return this.moderation.resolveReport(id, user.id, dto);
  }

  @Delete('content/:targetType/:id')
  @RequirePermission(Permission.PlatformModerate)
  removeContent(@Param('targetType') targetType: ReportTargetType, @Param('id') id: string) {
    return this.moderation.removeContent(targetType, id);
  }

  // --- Liste noire et mots interdits (admin) ---

  @Get('blacklist')
  @RequirePermission(Permission.PlatformModerate)
  blacklist() {
    return this.moderation.blacklist();
  }

  @Get('banned-words')
  @RequirePermission(Permission.PlatformModerate)
  bannedWords() {
    return this.moderation.listBannedWords();
  }

  @Post('banned-words')
  @RequirePermission(Permission.PlatformModerate)
  addBannedWord(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBannedWordDto) {
    return this.moderation.addBannedWord(dto.word, user.id);
  }

  @Delete('banned-words/:id')
  @RequirePermission(Permission.PlatformModerate)
  removeBannedWord(@Param('id') id: string) {
    return this.moderation.removeBannedWord(id);
  }
}
