import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { MediaService } from './media.service';

export class UploadUrlDto {
  @ApiProperty({
    example: 'image/jpeg',
    enum: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
  })
  @IsString()
  type!: string;

  @ApiProperty({
    example: 412_000,
    description: 'Taille en octets, mesurée après compression locale.',
  })
  @IsInt()
  @Min(1)
  size!: number;
}

@ApiTags('Médias')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload-url')
  @RequirePermission(Permission.MediaUpload)
  @ApiOperation({
    summary: 'Obtenir une URL présignée de téléversement.',
    description:
      'Le client téléverse ENSUITE le fichier directement vers le stockage ' +
      'objet (PUT sur `uploadUrl`), puis transmet `key` au point d’entrée métier. ' +
      'Aucun fichier utilisateur ne transite par le serveur applicatif.',
  })
  createUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: UploadUrlDto) {
    return this.media.createUploadUrl(user.id, dto.type, dto.size);
  }
}
