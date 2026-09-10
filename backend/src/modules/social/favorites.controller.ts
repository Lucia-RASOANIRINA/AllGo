import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { FavoritesService } from './favorites.service';
import { FAVORITABLE_TYPES, type FavoriteTargetType } from './schemas/interactions.schema';

export class AddFavoriteDto {
  @ApiPropertyOptional({ enum: FAVORITABLE_TYPES, default: 'product' })
  @IsOptional()
  @IsIn(FAVORITABLE_TYPES)
  targetType?: FavoriteTargetType;

  @ApiProperty({ description: 'Identifiant entier MySQL de la cible (product/shop/promotion/post).' })
  @IsNumberString()
  targetId!: string;
}

/**
 * `@Query() query: PaginationQueryDto` valide toute la requête brute contre
 * cette classe (`whitelist`/`forbidNonWhitelisted` globaux) : un `type` lu à
 * côté via `@Query('type')` sans être déclaré ici serait rejeté avec
 * `VALIDATION_FAILED` — voir `ShopQueryDto` pour le même constat sur `/shops`.
 */
export class FavoritesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FAVORITABLE_TYPES, default: 'product' })
  @IsOptional()
  @IsIn(FAVORITABLE_TYPES)
  type?: FavoriteTargetType;
}

@ApiTags('Favoris')
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({ summary: 'Lister mes favoris d’un type donné (produit par défaut).' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: FavoritesQueryDto) {
    return this.favorites.list(user.mysqlId, query.type ?? 'product', query.limit, query.cursor);
  }

  @Get('ids')
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({
    summary: 'Identifiants des favoris d’un type donné.',
    description:
      'Charge utile minimale, destinée à colorer les cœurs d’une grille sans ' +
      'transporter les fiches complètes.',
  })
  ids(@CurrentUser() user: AuthenticatedUser, @Query('type') type?: FavoriteTargetType) {
    return this.favorites.ids(user.mysqlId, type ?? 'product');
  }

  @Post()
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({
    summary: 'Ajouter un favori — produit, boutique, promotion ou publication.',
    description: 'Idempotent : ajouter deux fois la même cible ne crée qu’une entrée.',
  })
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddFavoriteDto) {
    return this.favorites.add(user.mysqlId, dto.targetType ?? 'product', dto.targetId);
  }

  @Delete(':targetId')
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({ summary: 'Retirer un favori.' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('targetId') targetId: string,
    @Query('type') type?: FavoriteTargetType,
  ) {
    return this.favorites.remove(user.mysqlId, type ?? 'product', targetId);
  }
}
