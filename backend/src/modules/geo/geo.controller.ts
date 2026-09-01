import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsLatitude,
  IsLongitude,
  IsMongoId,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

import { Public } from '../../common/decorators/auth.decorators';
import { GeoService } from './geo.service';

export class NearbyShopsQueryDto {
  @ApiProperty({ example: -15.7167, description: 'Latitude. Mahajanga ≈ -15,71.' })
  @Type(() => Number)
  @IsLatitude()
  lat!: number;

  @ApiProperty({ example: 46.3167, description: 'Longitude. Mahajanga ≈ 46,32.' })
  @Type(() => Number)
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({
    default: 5,
    maximum: 100,
    description: 'Rayon de recherche en kilomètres.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  radius = 5;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  category?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Ne renvoyer que les boutiques ouvertes (`true`) ou fermées (`false`).',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  openNow?: string;
}

@ApiTags('Géolocalisation')
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Public()
  @Get('shops')
  @ApiOperation({
    summary: 'Boutiques à proximité, triées par distance croissante.',
    description:
      'Renvoie `distanceM`, la distance en mètres sur l’ellipsoïde terrestre. ' +
      'Consultable sans compte : la découverte ne doit pas exiger d’inscription.',
  })
  nearby(@Query() query: NearbyShopsQueryDto) {
    return this.geo.nearbyShops({
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radius,
      categoryId: query.category,
      openNow: query.openNow === undefined ? undefined : query.openNow === 'true',
      limit: query.limit,
    });
  }

  @Public()
  @Get('products')
  @ApiOperation({
    summary: 'Produits à proximité, triés par distance croissante.',
    description: 'Même mécanique que `GET /geo/shops`, sur la localisation recopiée de la boutique.',
  })
  nearbyProducts(@Query() query: NearbyShopsQueryDto) {
    return this.geo.nearbyProducts({
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radius,
      categoryId: query.category,
      limit: query.limit,
    });
  }
}
