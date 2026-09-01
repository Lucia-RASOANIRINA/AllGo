import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

import { CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ShopsService } from './shops.service';
import { CreateShopDto, UpdateShopDto } from './dto/shop.dto';
import { AddTeamMemberDto, UpdateTeamMemberDto } from './dto/team.dto';

/**
 * `@Query() query: PaginationQueryDto` valide l'INTÉGRALITÉ de la requête
 * brute contre cette classe (`whitelist`/`forbidNonWhitelisted` globaux) : un
 * paramètre lu séparément via `@Query('q')` sans être déclaré ici est rejeté
 * avec `VALIDATION_FAILED`, jamais silencieusement ignoré. C'est ce qui
 * rendait `q`, `openNow` et `sort` inutilisables sur `GET /shops`.
 */
export class ShopQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Recherche plein texte sur le nom et la description.' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Ne renvoyer que les boutiques ouvertes (`true`) ou fermées (`false`).',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  openNow?: string;

  @ApiPropertyOptional({ enum: ['popular'], description: 'Tri par nombre d’abonnés.' })
  @IsOptional()
  @IsIn(['popular'])
  sort?: 'popular';
}

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
  list(@Query() query: ShopQueryDto) {
    const openNowFlag = query.openNow === undefined ? undefined : query.openNow === 'true';
    return this.shops.list(query.limit, query.cursor, query.q, openNowFlag, query.sort);
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

  @Public()
  @Get('shop/:shopId/posts')
  @ApiOperation({ summary: 'Publications d’une boutique — onglet « Publications » de sa fiche.' })
  posts(@Param('shopId') shopId: string, @Query() query: PaginationQueryDto) {
    return this.shops.postsFor(shopId, query.limit, query.cursor);
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
