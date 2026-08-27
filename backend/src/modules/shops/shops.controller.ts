import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ShopsService } from './shops.service';

@ApiTags('Boutiques')
@Controller()
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Public()
  @Get('shops')
  @ApiOperation({ summary: 'Lister les boutiques validées.' })
  list(@Query() query: PaginationQueryDto, @Query('q') q?: string) {
    return this.shops.list(query.limit, query.cursor, q);
  }

  @Get('me/shops')
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({ summary: 'Boutiques où je détiens un rôle (sélecteur de profil).' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.shops.myShops(user.id);
  }

  @Public()
  @Get('shops/:slug')
  @ApiOperation({ summary: 'Consulter une boutique par son identifiant lisible.' })
  findOne(@Param('slug') slug: string) {
    return this.shops.findBySlug(slug);
  }

  @Get('shop/:shopId/dashboard')
  @RequirePermission(Permission.ShopDashboard, 'shopId')
  @ApiOperation({ summary: 'Tableau de bord de la boutique.' })
  dashboard(@Param('shopId') shopId: string) {
    return this.shops.dashboard(shopId);
  }

  @Get('shop/:shopId/team')
  @RequirePermission(Permission.TeamManage, 'shopId')
  @ApiOperation({ summary: 'Membres de l’équipe.' })
  team(@Param('shopId') shopId: string) {
    return this.shops.team(shopId);
  }
}
