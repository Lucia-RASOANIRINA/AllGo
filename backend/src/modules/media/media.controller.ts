import { Body, Controller, Param, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';
import type { Request } from 'express';

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
    summary: 'Obtenir une URL de téléversement à usage unique.',
    description:
      'Le client téléverse ENSUITE le fichier (PUT sur `uploadUrl`, octets bruts, ' +
      'même en-tête `Content-Type`). Le jeton contenu dans l’URL n’est valable ' +
      'qu’une fois et expire après `expiresIn` secondes.',
  })
  createUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: UploadUrlDto) {
    return this.media.createUploadUrl(user.id, dto.type, dto.size);
  }

  @Put('upload/:token')
  @RequirePermission(Permission.MediaUpload)
  @ApiOperation({ summary: 'Téléverser les octets bruts d’un fichier (voir `upload-url`).' })
  async receiveUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
    @Req() req: Request,
  ) {
    const body = req.body;
    const buffer = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    return this.media.receiveUpload(token, user.id, buffer);
  }
}
