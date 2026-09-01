import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsMongoId, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { MessagingService } from './messaging.service';

export class CreateConversationDto {
  @ApiProperty() @IsMongoId() participantId!: string;
}

export class MessageAttachmentDto {
  @ApiProperty() @IsString() url!: string;
  @ApiProperty({ enum: ['image', 'video', 'product', 'order'] })
  @IsIn(['image', 'video', 'product', 'order'])
  type!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() name?: string;
}

export class SendMessageDto {
  @ApiProperty() @IsString() @MaxLength(4000) content!: string;
  @ApiProperty({ required: false, type: [MessageAttachmentDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
}

@ApiTags('Messagerie')
@Controller('conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @RequirePermission(Permission.MessageRead)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.messaging.list(user.id);
  }

  @Post()
  @RequirePermission(Permission.MessageSend)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConversationDto) {
    return this.messaging.create(user, dto.participantId);
  }

  @Get(':id/messages')
  @RequirePermission(Permission.MessageRead)
  messages(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.messaging.listMessages(id, user.id, query.limit);
  }

  @Post(':id/messages')
  @RequirePermission(Permission.MessageSend)
  send(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.messaging.send(id, user, dto.content, dto.attachments);
  }
}
