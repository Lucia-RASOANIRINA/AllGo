import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ShopsService } from './shops.service';
import { CreateShopDto, UpdateShopDto } from './dto/shop.dto';
import { AddTeamMemberDto, UpdateTeamMemberDto } from './dto/team.dto';

@ApiTags('Boutiques')
@Controller()
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Post('shops')
  @RequirePermission(Permission.ShopCreate)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateShopDto) {
    return this.shops.create(user.id, dto);
  }

  @Patch('shop/:shopId')
  @RequirePermission(Permission.ShopUpdate, 'shopId')
  update(@CurrentUser() user: AuthenticatedUser, @Param('shopId') shopId: string, @Body() dto: UpdateShopDto) {
    return this.shops.update(user.id, shopId, dto);
  }

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

  @Post('shop/:shopId/team')
  @RequirePermission(Permission.TeamManage, 'shopId')
  addTeamMember(@Param('shopId') shopId: string, @Body() dto: AddTeamMemberDto) {
    return this.shops.addTeamMember(shopId, dto);
  }

  @Patch('shop/:shopId/team/:userId')
  @RequirePermission(Permission.TeamManage, 'shopId')
  updateTeamMember(@Param('shopId') shopId: string, @Param('userId') userId: string, @Body() dto: UpdateTeamMemberDto) {
    return this.shops.updateTeamMember(shopId, userId, dto);
  }

  @Delete('shop/:shopId/team/:userId')
  @RequirePermission(Permission.TeamManage, 'shopId')
  removeTeamMember(@Param('shopId') shopId: string, @Param('userId') userId: string) {
    return this.shops.removeTeamMember(shopId, userId);
  }
}
