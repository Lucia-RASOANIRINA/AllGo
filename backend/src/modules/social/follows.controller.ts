import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { FollowsService } from './follows.service';

@ApiTags('Abonnements')
@Controller('me/follows/shops')
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @Get()
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({ summary: 'Boutiques suivies, enrichies (pour l’écran Favoris).' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.follows.listFollowedShops(user.mysqlId, query.limit, query.cursor);
  }

  @Get('ids')
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({ summary: 'Identifiants des boutiques suivies.' })
  ids(@CurrentUser() user: AuthenticatedUser) {
    return this.follows.followedShopIds(user.mysqlId);
  }

  @Post(':shopId')
  @RequirePermission(Permission.FollowToggle)
  @ApiOperation({ summary: 'Suivre une boutique.' })
  follow(@CurrentUser() user: AuthenticatedUser, @Param('shopId') shopId: string) {
    return this.follows.followShop(user.mysqlId, shopId);
  }

  @Delete(':shopId')
  @RequirePermission(Permission.FollowToggle)
  @ApiOperation({ summary: 'Ne plus suivre une boutique.' })
  unfollow(@CurrentUser() user: AuthenticatedUser, @Param('shopId') shopId: string) {
    return this.follows.unfollowShop(user.mysqlId, shopId);
  }
}
