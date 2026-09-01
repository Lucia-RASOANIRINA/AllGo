import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsArray, IsDateString, IsIn, IsMongoId, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SocialService } from './social.service';

class PostMediaDto {
  @ApiProperty() @IsString() url!: string;
  @ApiProperty({ enum: ['image', 'video'] }) @IsIn(['image', 'video']) type!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() thumbUrl?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() previewUrl?: string;
}

export class CreatePostDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(5000) content?: string;
  @ApiProperty({ type: [PostMediaDto], required: false })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PostMediaDto)
  media?: PostMediaDto[];
  @ApiProperty({ required: false }) @IsOptional() @IsMongoId() productId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsMongoId() promotionId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsMongoId() shopId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsDateString() scheduledAt?: string;
  @ApiProperty({ enum: ['public', 'followers'], required: false })
  @IsOptional() @IsIn(['public', 'followers']) visibility?: 'public' | 'followers';
}

export class CommentDto {
  @ApiProperty() @IsString() @MaxLength(2000) content!: string;
}

export class ReportPostDto {
  @ApiProperty({ required: false, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

@ApiTags('Publications')
@Controller('social')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('posts')
  @RequirePermission(Permission.PostRead)
  feed(@Query() query: PaginationQueryDto) {
    return this.social.feed(query.limit, query.cursor);
  }

  @Post('posts')
  @RequirePermission(Permission.PostCreate)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePostDto) {
    return this.social.create(user, dto);
  }

  @Patch('posts/:id')
  @RequirePermission(Permission.PostUpdate)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreatePostDto) {
    return this.social.update(user.id, id, dto);
  }

  @Delete('posts/:id')
  @RequirePermission(Permission.PostDelete)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.social.remove(user.id, id);
  }

  @Post('posts/:id/reactions')
  @RequirePermission(Permission.ReactionToggle)
  react(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.social.toggleReaction(user.id, id);
  }

  @Get('posts/:id/comments')
  @RequirePermission(Permission.PostRead)
  listComments(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.social.commentsFor(id, query.limit);
  }

  @Post('posts/:id/comments')
  @RequirePermission(Permission.CommentCreate)
  comment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.social.comment(user, id, dto.content);
  }

  @Post('posts/:id/share')
  @RequirePermission(Permission.PostShare)
  @ApiOperation({ summary: 'Partager une publication (compteur).' })
  share(@Param('id') id: string) {
    return this.social.share(id);
  }

  @Post('posts/:id/report')
  @RequirePermission(Permission.PostReport)
  @ApiOperation({ summary: 'Signaler une publication à la modération.' })
  report(@Param('id') id: string, @Body() dto: ReportPostDto) {
    return this.social.report(id, dto.reason);
  }
}
