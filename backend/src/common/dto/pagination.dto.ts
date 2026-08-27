import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Paramètres de pagination communs à toutes les listes — §7.1. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 100, description: 'Nombre d’éléments par page.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ description: 'Curseur opaque renvoyé par la page précédente.' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Liste de champs à renvoyer, séparés par des virgules. Réduit le volume réseau.',
    example: 'id,name,price,media',
  })
  @IsOptional()
  @IsString()
  fields?: string;
}
