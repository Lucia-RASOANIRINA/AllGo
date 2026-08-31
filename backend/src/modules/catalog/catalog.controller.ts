import { Body, Controller, Delete, Get, Header, Param, Post, Query } from '@nestjs/common';
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
import { CatalogService } from './catalog.service';

export class UpsertProductReviewDto {
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

export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsMongoId() category?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() shop?: string;
  @ApiPropertyOptional({
    description: 'Recherche plein texte, pondérée nom (10) / description (2).',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Prix minimum en Ariary.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Prix maximum en Ariary.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Ne renvoyer que les produits en stock.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  inStock?: boolean;

  @ApiPropertyOptional({
    enum: ['new', 'popular'],
    default: 'new',
    description: 'Tri : plus récents ou plus consultés (`stats.views`).',
  })
  @IsOptional()
  @IsIn(['new', 'popular'])
  sort?: 'new' | 'popular';

  @ApiPropertyOptional({ description: 'Ne renvoyer que les produits en promotion.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onSale?: boolean;

  @ApiPropertyOptional({ description: 'Ne renvoyer que les promotions flash actives.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  flashOnly?: boolean;

  @ApiPropertyOptional({ description: 'Note minimale (`stats.rating`), de 0 à 5.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;
}

@ApiTags('Catalogue')
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Lister le catalogue, filtré et paginé par curseur.' })
  listProducts(@Query() query: ProductQueryDto) {
    return this.catalog.listProducts({
      limit: query.limit,
      cursor: query.cursor,
      fields: query.fields,
      categoryId: query.category,
      shopId: query.shop,
      q: query.q,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      inStock: query.inStock,
      sort: query.sort,
      onSale: query.onSale,
      flashOnly: query.flashOnly,
      minRating: query.minRating,
    });
  }

  @Public()
  @Get('products/barcode/:code')
  @ApiOperation({ summary: 'Identifier un produit par son code-barres (scan mobile).' })
  findByBarcode(@Param('code') code: string, @Query('shop') shopId?: string) {
    return this.catalog.findByBarcode(code, shopId);
  }

  @Public()
  @Get('products/:id')
  @ApiOperation({ summary: 'Consulter une fiche produit.' })
  findProduct(@Param('id') id: string) {
    return this.catalog.findProduct(id);
  }

  @Public()
  @Get('products/:id/similar')
  @ApiOperation({ summary: 'Produits similaires : même catégorie, plus récents.' })
  similarProducts(@Param('id') id: string) {
    return this.catalog.relatedProducts(id, 'similar', 10);
  }

  @Public()
  @Get('products/:id/recommended')
  @ApiOperation({ summary: 'Produits recommandés : même catégorie, les plus consultés.' })
  recommendedProducts(@Param('id') id: string) {
    return this.catalog.relatedProducts(id, 'recommended', 10);
  }

  @Public()
  @Get('products/:id/reviews')
  @ApiOperation({ summary: 'Avis d’un produit.' })
  productReviews(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.catalog.listProductReviews(id, query.limit, query.cursor);
  }

  @Post('products/:id/reviews')
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({
    summary: 'Déposer ou remplacer mon avis sur un produit.',
    description: 'Un seul avis par client et par produit : le redéposer le met à jour.',
  })
  async upsertProductReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertProductReviewDto,
  ) {
    const profile = (await this.users.findById(user.id)) as {
      firstName: string;
      lastName: string;
      avatar?: string;
    };
    return this.catalog.upsertProductReview(
      id,
      user.id,
      { name: `${profile.firstName} ${profile.lastName}`.trim(), avatar: profile.avatar },
      dto.rating,
      dto.comment,
    );
  }

  @Delete('products/:id/reviews/me')
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({ summary: 'Retirer mon avis sur un produit.' })
  removeProductReview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.catalog.removeOwnProductReview(id, user.id);
  }

  @Public()
  @Get('categories')
  // Référentiel quasi statique : validation par ETag côté client (§7.1),
  // 24 h de fraîcheur locale (§9.2).
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({ summary: 'Arborescence complète des catégories.' })
  categories() {
    return this.catalog.categoryTree();
  }
}
