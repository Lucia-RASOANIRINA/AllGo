import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { StoriesService } from './stories.service';

export class CreateStoryDto {
  @ApiProperty() @IsString() url!: string;
  @ApiProperty({ enum: ['image', 'video'] }) @IsIn(['image', 'video']) type!: 'image' | 'video';
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
  view(@Param('id') id: string) {
    return this.stories.view(id);
  }
}
