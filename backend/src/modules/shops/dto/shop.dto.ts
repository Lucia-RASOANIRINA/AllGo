import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

export class CreateShopDto {
  @ApiProperty() @IsString() @MaxLength(120) name!: string;
  @ApiProperty() @IsString() @MaxLength(140) slug!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() logo?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() banner?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoryName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() whatsapp?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) deliveryRadiusKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() deliveryAvailable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pickupAvailable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) deliveryFee?: number;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() closedDays?: number[];
  @ApiPropertyOptional({ type: [Object] }) @IsOptional() @IsArray() openingHours?: Array<{ day: number; open: string; close: string }>;
}

export class UpdateShopDto extends CreateShopDto {}
