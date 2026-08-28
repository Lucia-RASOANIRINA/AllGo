import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UsersService } from '../users/users.service';
import { ShopsService } from './shops.service';

export class UpsertReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

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
  constructor(
    private readonly shops: ShopsService,
    private readonly users: UsersService,
  ) {}

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

  @Public()
  @Get('shops/:shopId/reviews')
  @ApiOperation({ summary: 'Avis d’une boutique.' })
  reviews(@Param('shopId') shopId: string, @Query() query: PaginationQueryDto) {
    return this.shops.listReviews(shopId, query.limit, query.cursor);
  }

  @Post('shops/:shopId/reviews')
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({
    summary: 'Déposer ou remplacer mon avis.',
    description: 'Un seul avis par client et par boutique : le redéposer le met à jour.',
  })
  async upsertReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('shopId') shopId: string,
    @Body() dto: UpsertReviewDto,
  ) {
    const profile = (await this.users.findById(user.id)) as {
      firstName: string;
      lastName: string;
      avatar?: string;
    };
    return this.shops.upsertReview(
      shopId,
      user.id,
      { name: `${profile.firstName} ${profile.lastName}`.trim(), avatar: profile.avatar },
      dto.rating,
      dto.comment,
    );
  }

  @Delete('shops/:shopId/reviews/me')
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({ summary: 'Retirer mon avis.' })
  removeReview(@CurrentUser() user: AuthenticatedUser, @Param('shopId') shopId: string) {
    return this.shops.removeOwnReview(shopId, user.id);
  }
}
