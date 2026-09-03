import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CreateBannedWordDto, IssueSanctionDto, ReportDto, ResolveReportDto } from './dto/moderation.dto';
import { ModerationService } from './moderation.service';
import type { ReportStatus, ReportTargetType } from './schemas/report.schema';

@ApiTags('Modération')
@Controller('moderation')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

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
  block(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.moderation.blockUser(user.id, id);
  }

  @Delete('users/:id/block')
  @RequirePermission(Permission.UserBlock)
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.moderation.unblockUser(user.id, id);
  }

  @Get('blocked-users')
  @RequirePermission(Permission.ProfileRead)
  blockedUsers(@CurrentUser() user: AuthenticatedUser) {
    return this.moderation.listBlockedUsers(user.id);
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
