import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { GeoPointDto } from '../../orders/dto/create-order.dto';

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) bio?: string;
  @ApiPropertyOptional({ description: 'Clé du média téléversé via /media/upload-url.' })
  @IsOptional()
  @IsString()
  avatarKey?: string;

  @ApiPropertyOptional({
    enum: ['fr', 'mg'],
    description: 'Français par défaut, malgache en seconde langue.',
  })
  @IsOptional()
  @IsIn(['fr', 'mg'])
  locale?: 'fr' | 'mg';

  @ApiPropertyOptional({ enum: ['light', 'dark', 'system'] })
  @IsOptional()
  @IsIn(['light', 'dark', 'system'])
  theme?: 'light' | 'dark' | 'system';

  @ApiPropertyOptional() @IsOptional() @IsBoolean() pushEnabled?: boolean;
}

export class CreateAddressDto {
  @ApiProperty({ example: 'Domicile' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  label!: string;

  @ApiProperty({ example: 'Mahajanga' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city!: string;

  @ApiPropertyOptional({ example: 'Mahavoky Atsimo' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  district?: string;

  @ApiProperty({ example: 'Lot II M 45 bis, près de la station Jovenna' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  line!: string;

  @ApiPropertyOptional({ type: GeoPointDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  location?: GeoPointDto;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
