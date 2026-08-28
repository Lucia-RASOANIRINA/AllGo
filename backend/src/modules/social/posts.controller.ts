import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

import { CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UsersService } from '../users/users.service';
import { PostsService } from './posts.service';

export class AddCommentDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  content!: string;
}

@ApiTags('Publications')
@Controller()
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly users: UsersService,
  ) {}

  @Public()
  @Get('shops/:shopId/posts')
  @ApiOperation({ summary: 'Publications d’une boutique.' })
  listByShop(@Param('shopId') shopId: string, @Query() query: PaginationQueryDto) {
    return this.posts.listByShop(shopId, query.limit, query.cursor);
  }

  @Post('posts/:id/reactions')
  @RequirePermission(Permission.ReactionToggle)
  @ApiOperation({ summary: 'Réagir à une publication.' })
  react(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.posts.react(id, user.id, 'like');
  }

  @Delete('posts/:id/reactions')
  @RequirePermission(Permission.ReactionToggle)
  @ApiOperation({ summary: 'Retirer ma réaction.' })
  unreact(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.posts.unreact(id, user.id);
  }

  @Public()
  @Get('posts/:id/comments')
  @ApiOperation({ summary: 'Commentaires d’une publication.' })
  listComments(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.posts.listComments(id, query.limit, query.cursor);
  }

  @Post('posts/:id/comments')
  @RequirePermission(Permission.CommentCreate)
  @ApiOperation({ summary: 'Commenter une publication.' })
  async addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddCommentDto,
  ) {
    const profile = (await this.users.findById(user.id)) as {
      firstName: string;
      lastName: string;
      avatar?: string;
    };
    return this.posts.addComment(
      id,
      user.id,
      { name: `${profile.firstName} ${profile.lastName}`.trim(), avatar: profile.avatar },
      dto.content,
    );
  }
}
