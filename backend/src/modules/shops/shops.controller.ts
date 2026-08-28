import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ShopsService } from './shops.service';

export class ShopQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;

  @ApiPropertyOptional({
    enum: ['new', 'popular'],
    default: 'new',
    description: 'Tri : plus récentes ou plus suivies (`stats.followerCount`).',
  })
  @IsOptional()
  @IsIn(['new', 'popular'])
  sort?: 'new' | 'popular';

  @ApiPropertyOptional({ description: 'Catégorie de la boutique (« type de commerce »).' })
  @IsOptional()
  @IsMongoId()
  category?: string;

  @ApiPropertyOptional({ description: 'Ne renvoyer que les boutiques livrant.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  delivery?: boolean;

  @ApiPropertyOptional({ description: 'Ne renvoyer que les boutiques proposant le retrait.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  pickup?: boolean;

  @ApiPropertyOptional({ description: 'Ne renvoyer que les boutiques ouvertes maintenant.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  openNow?: boolean;

  @ApiPropertyOptional({ description: 'Note minimale (`stats.rating`), de 0 à 5.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;
}

@ApiTags('Boutiques')
@Controller()
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Public()
  @Get('shops')
  @ApiOperation({ summary: 'Lister les boutiques validées.' })
  list(@Query() query: ShopQueryDto) {
    return this.shops.list({
      limit: query.limit,
      cursor: query.cursor,
      q: query.q,
      sort: query.sort,
      categoryId: query.category,
      delivery: query.delivery,
      pickup: query.pickup,
      openNow: query.openNow,
      minRating: query.minRating,
    });
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
