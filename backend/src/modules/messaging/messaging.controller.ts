import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsMongoId, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { MessagingService } from './messaging.service';

export class CreateConversationDto {
  @ApiPropertyOptional({ description: 'Autre utilisateur — pour un dialogue client ↔ livreur.' })
  @IsOptional()
  @IsMongoId()
  participantId?: string;

  @ApiPropertyOptional({ description: 'Boutique — pour « Envoyer un message » depuis une fiche boutique.' })
  @IsOptional()
  @IsMongoId()
  shopId?: string;
}

export class ReportConversationDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
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
    return this.messaging.create(user, { participantId: dto.participantId, shopId: dto.shopId });
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

  @Post(':id/block')
  @RequirePermission(Permission.MessageBlock)
  @ApiOperation({ summary: 'Bloquer une conversation — ferme le canal dans les deux sens.' })
  block(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.messaging.block(id, user.id);
  }

  @Delete(':id/block')
  @RequirePermission(Permission.MessageBlock)
  @ApiOperation({ summary: 'Débloquer une conversation que j’avais bloquée.' })
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.messaging.unblock(id, user.id);
  }

  @Post(':id/report')
  @RequirePermission(Permission.MessageReport)
  @ApiOperation({ summary: 'Signaler une conversation à la modération.' })
  report(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReportConversationDto) {
    return this.messaging.report(id, user.id, dto.reason);
  }
}
