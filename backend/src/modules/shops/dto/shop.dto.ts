import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
  @ApiPropertyOptional({ example: -15.7167, description: 'Latitude de la boutique.' })
  @IsOptional() @IsNumber() latitude?: number;
  @ApiPropertyOptional({ example: 46.3167, description: 'Longitude de la boutique.' })
  @IsOptional() @IsNumber() longitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) deliveryRadiusKm?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() deliveryAvailable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pickupAvailable?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) deliveryFee?: number;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() closedDays?: number[];
  @ApiPropertyOptional({ type: [Object] }) @IsOptional() @IsArray() openingHours?: Array<{ day: number; open: string; close: string }>;
}

/**
 * Partielle, contrairement à `CreateShopDto` : modifier une boutique
 * n'exige pas de reposter `name`/`slug` à chaque appel (§17). Un slug
 * n'est de toute façon jamais modifié après création — changer l'adresse
 * publique d'une boutique casserait tous les liens déjà partagés.
 */
export class UpdateShopDto extends PartialType(CreateShopDto) {
  /**
   * Clé retournée par `POST /media/upload-url`, jamais une URL saisie à la
   * main (`logo` l'exige encore pour compatibilité, mais un commerçant ne
   * connaît pas l'URL finale de son fichier avant même de l'avoir envoyé).
   * Prioritaire sur `logo` si les deux sont fournis.
   */
  @ApiPropertyOptional() @IsOptional() @IsString() logoKey?: string;
}
