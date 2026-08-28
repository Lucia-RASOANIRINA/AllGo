import { Controller, Get, Header, Param, Query } from '@nestjs/common';
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

import { Public } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CatalogService } from './catalog.service';

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
  constructor(private readonly catalog: CatalogService) {}

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
  @Get('categories')
  // Référentiel quasi statique : validation par ETag côté client (§7.1),
  // 24 h de fraîcheur locale (§9.2).
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({ summary: 'Arborescence complète des catégories.' })
  categories() {
    return this.catalog.categoryTree();
  }
}
