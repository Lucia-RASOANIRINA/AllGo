import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class GeoPointDto {
  @ApiProperty({ enum: ['Point'], default: 'Point' })
  @IsIn(['Point'])
  type = 'Point' as const;

  @ApiProperty({
    example: [46.3167, -15.7167],
    description: 'ORDRE GeoJSON : [longitude, latitude]. Inverser est l’erreur classique (§15.4).',
  })
  @IsArray()
  @IsNumber({}, { each: true })
  coordinates!: [number, number];
}

export class DeliveryDto {
  @ApiProperty({ enum: ['delivery', 'pickup'] })
  @IsIn(['delivery', 'pickup'])
  method!: 'delivery' | 'pickup';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Précision pour le livreur : repère, étage, code…' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @ApiPropertyOptional({ type: GeoPointDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;
}

export class CreateOrderDto {
  @ApiProperty({ type: DeliveryDto })
  @ValidateNested()
  @Type(() => DeliveryDto)
  delivery!: DeliveryDto;

  @ApiProperty({ enum: ['cod', 'mvola', 'orange_money', 'airtel_money', 'card'] })
  @IsIn(['cod', 'mvola', 'orange_money', 'airtel_money', 'card'])
  paymentMethod!: string;

  @ApiPropertyOptional({ description: 'Frais de livraison en Ariary, calculés par la boutique.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingFee?: number;

  @ApiPropertyOptional({ description: 'Code de réduction éventuel.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  couponCode?: string;

  @ApiPropertyOptional({
    description:
      'Pourboire pour le livreur, en Ariary. Sans effet pour un retrait en boutique (aucun livreur).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tip?: number;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ['confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'] })
  @IsIn(['confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'])
  status!: 'confirmed' | 'preparing' | 'shipped' | 'delivered' | 'cancelled';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
