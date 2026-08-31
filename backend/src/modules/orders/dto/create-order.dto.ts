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

export class DeliverySlotDto {
  @ApiProperty({ description: 'Date ISO (AAAA-MM-JJ).' })
  @IsString()
  date!: string;

  @ApiProperty({ enum: ['morning', 'afternoon', 'evening'] })
  @IsIn(['morning', 'afternoon', 'evening'])
  window!: 'morning' | 'afternoon' | 'evening';
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

  @ApiPropertyOptional({
    description:
      'Créneau souhaité — préférence transmise au commerçant, sans moteur de ' +
      'capacité/disponibilité derrière (§ décisions de portée).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliverySlotDto)
  slot?: DeliverySlotDto;
}

export class CreateOrderDto {
  @ApiProperty({ type: DeliveryDto })
  @ValidateNested()
  @Type(() => DeliveryDto)
  delivery!: DeliveryDto;

  @ApiProperty({ enum: ['cod', 'mvola', 'orange_money', 'airtel_money', 'card'] })
  @IsIn(['cod', 'mvola', 'orange_money', 'airtel_money', 'card'])
  paymentMethod!: string;

  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Ignoré : le serveur calcule désormais toujours les frais de livraison ' +
      '(`GeoService.computeDeliveryFee`). Conservé pour compatibilité descendante.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingFee?: number;

  @ApiPropertyOptional({ description: 'Code de réduction éventuel.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  couponCode?: string;
}

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: [
      'confirmed',
      'preparing',
      'ready',
      'courier_assigned',
      'shipped',
      'delivered',
      'cancelled',
    ],
  })
  @IsIn([
    'confirmed',
    'preparing',
    'ready',
    'courier_assigned',
    'shipped',
    'delivered',
    'cancelled',
  ])
  status!:
    | 'confirmed'
    | 'preparing'
    | 'ready'
    | 'courier_assigned'
    | 'shipped'
    | 'delivered'
    | 'cancelled';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
