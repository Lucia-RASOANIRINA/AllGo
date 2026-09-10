import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumberString, IsOptional, IsString } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { StoriesService } from './stories.service';

export class CreateStoryDto {
  @ApiProperty({ description: 'Clé S3 renvoyée par POST /media/upload-url, après le PUT du fichier.' })
  @IsString()
  key!: string;
  @ApiProperty({ enum: ['image', 'video'] }) @IsIn(['image', 'video']) type!: 'image' | 'video';
  @ApiPropertyOptional({ description: 'Identifiant numérique MySQL du produit.' }) @IsOptional() @IsNumberString() productId?: string;
  @ApiPropertyOptional({ description: 'Identifiant numérique MySQL de la promotion.' }) @IsOptional() @IsNumberString() promotionId?: string;
}

@ApiTags('Stories')
@Controller('social/stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get()
  @RequirePermission(Permission.PostRead)
  list() {
    return this.stories.list();
  }

  @Post()
  @RequirePermission(Permission.StoryCreate)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStoryDto) {
    return this.stories.create(user, dto);
  }

  @Post(':id/view')
  @RequirePermission(Permission.PostRead)
  view(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.stories.view(id, user.mysqlId);
  }

  @Get(':id/viewers')
  @RequirePermission(Permission.StoryCreate)
  viewers(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.stories.viewers(id, user.mysqlId);
  }

  @Post(':id/reactions')
  @RequirePermission(Permission.ReactionToggle)
  react(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.stories.toggleReaction(user.mysqlId, id);
  }
}
