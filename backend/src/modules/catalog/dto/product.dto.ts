import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProductMediaDto {
  @ApiProperty() @IsString() url!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() thumbUrl?: string;
  @ApiPropertyOptional({ enum: ['image', 'video'] })
  @IsOptional() @IsIn(['image', 'video']) type?: 'image' | 'video';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isMain?: boolean;
}

export class ProductVariantDto {
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() size?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() color?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() priceDelta?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) stock?: number;
}

export class CreateProductDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() slug!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() barcode?: string;
  @ApiPropertyOptional() @IsOptional() @IsMongoId() categoryId?: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) price!: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) promoPrice?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) stock?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minStock?: number;
  @ApiPropertyOptional({ type: [ProductMediaDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductMediaDto)
  media?: ProductMediaDto[];
  @ApiPropertyOptional({ type: [ProductVariantDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAvailable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFeatured?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isHidden?: boolean;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}
