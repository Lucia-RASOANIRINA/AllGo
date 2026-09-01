import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, Max, Min } from 'class-validator';

import { Public } from '../../common/decorators/auth.decorators';
import { SearchService } from './search.service';

export class GlobalSearchQueryDto {
  @ApiPropertyOptional({ description: 'Terme recherché.' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: 5, maximum: 20, description: 'Résultats par catégorie.' })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(20)
  limit = 5;
}

@ApiTags('Recherche')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Recherche globale — produits, boutiques et catégories en un seul appel.',
  })
  global(@Query() query: GlobalSearchQueryDto) {
    return this.search.global(query.q ?? '', query.limit);
  }
}
