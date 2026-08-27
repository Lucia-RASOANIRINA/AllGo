import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { FavoritesService } from './favorites.service';

export class AddFavoriteDto {
  @ApiProperty()
  @IsMongoId()
  productId!: string;
}

@ApiTags('Favoris')
@Controller('me/favorites')
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({ summary: 'Lister mes produits favoris.' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.favorites.list(user.id, query.limit, query.cursor);
  }

  @Get('ids')
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({
    summary: 'Identifiants des produits favoris.',
    description:
      'Charge utile minimale, destinée à colorer les cœurs d’une grille sans ' +
      'transporter les fiches complètes.',
  })
  ids(@CurrentUser() user: AuthenticatedUser) {
    return this.favorites.productIds(user.id);
  }

  @Post()
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({
    summary: 'Ajouter un favori.',
    description: 'Idempotent : ajouter deux fois le même produit ne crée qu’une entrée.',
  })
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddFavoriteDto) {
    return this.favorites.add(user.id, dto.productId);
  }

  @Delete(':productId')
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({ summary: 'Retirer un favori.' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('productId') productId: string) {
    return this.favorites.remove(user.id, productId);
  }
}
