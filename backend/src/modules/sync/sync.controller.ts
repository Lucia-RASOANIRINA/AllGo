import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SyncService } from './sync.service';

export class ChangesQueryDto {
  @ApiPropertyOptional({
    description: 'Horodatage ISO de la dernière synchronisation réussie.',
    example: '2026-08-18T06:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  since?: Date;

  @ApiPropertyOptional({
    description: 'Collections à synchroniser, séparées par des virgules.',
    example: 'products,orders,categories',
  })
  @IsOptional()
  @IsString()
  collections?: string;
}

@ApiTags('Synchronisation')
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('changes')
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({
    summary: 'Récupérer les documents modifiés depuis un horodatage.',
    description:
      'Synchronisation delta (§9.5) : jamais un catalogue complet, uniquement ' +
      'les documents modifiés. Sur un forfait de données malgache, la ' +
      'différence est décisive.',
  })
  changes(@CurrentUser() user: AuthenticatedUser, @Query() query: ChangesQueryDto) {
    return this.sync.changesSince(user, query.since, query.collections?.split(','));
  }
}
