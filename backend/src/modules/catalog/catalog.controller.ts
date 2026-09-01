import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsMongoId, IsNumber, IsOptional, IsString, Min } from 'class-validator';

import { Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import { CreateProductDto, ImportProductsDto, UpdateProductDto } from './dto/product.dto';
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
    enum: ['newest', 'popular'],
    description: 'Tri d’un rail de vitrine (accueil). Sans effet si `cursor` est fourni.',
  })
  @IsOptional()
  @IsIn(['newest', 'popular'])
  sort?: 'newest' | 'popular';

  @ApiPropertyOptional({ description: 'Ne renvoyer que les produits en promotion.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onSale?: boolean;
}

@ApiTags('Catalogue')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('shop/:shopId/products')
  @RequirePermission(Permission.ProductRead, 'shopId')
  merchantProducts(@Param('shopId') shopId: string) {
    return this.catalog.listShopProducts(shopId);
  }

  @Post('shop/:shopId/products')
  @RequirePermission(Permission.ProductCreate, 'shopId')
  createProduct(@Param('shopId') shopId: string, @Body() dto: CreateProductDto) {
    return this.catalog.createProduct(shopId, dto);
  }

  @Patch('shop/:shopId/products/:id')
  @RequirePermission(Permission.ProductUpdate, 'shopId')
  updateProduct(@Param('shopId') shopId: string, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(shopId, id, dto);
  }

  @Delete('shop/:shopId/products/:id')
  @RequirePermission(Permission.ProductDelete, 'shopId')
  deleteProduct(@Param('shopId') shopId: string, @Param('id') id: string) {
    return this.catalog.deleteProduct(shopId, id);
  }

  @Post('shop/:shopId/products/:id/duplicate')
  @RequirePermission(Permission.ProductCreate, 'shopId')
  duplicateProduct(@Param('shopId') shopId: string, @Param('id') id: string) {
    return this.catalog.duplicateProduct(shopId, id);
  }

  @Post('shop/:shopId/products/import')
  @RequirePermission(Permission.ProductCreate, 'shopId')
  @ApiOperation({ summary: 'Importer des produits en masse.' })
  importProducts(@Param('shopId') shopId: string, @Body() dto: ImportProductsDto) {
    return this.catalog.importProducts(shopId, dto.items);
  }

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
  @ApiOperation({ summary: 'Produits similaires — même catégorie, à défaut même boutique.' })
  similarProducts(@Param('id') id: string, @Query('limit') limit?: number) {
    return this.catalog.similarProducts(id, Math.min(Number(limit) || 8, 20));
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
