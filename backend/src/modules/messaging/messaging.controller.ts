import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsMongoId, IsString, MaxLength } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UsersService } from '../users/users.service';
import { MessagingService } from './messaging.service';

export class StartConversationDto {
  @ApiProperty() @IsMongoId() shopId!: string;
}

export class SendMessageDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  content!: string;
}

@ApiTags('Messagerie')
@Controller()
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly users: UsersService,
  ) {}

  @Post('me/conversations')
  @RequirePermission(Permission.MessageSend)
  @ApiOperation({ summary: 'Ouvrir (ou reprendre) une conversation avec une boutique.' })
  async start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartConversationDto) {
    const profile = (await this.users.findById(user.id)) as { firstName: string; lastName: string };
    return this.messaging.getOrCreateWithShop(
      user.id,
      `${profile.firstName} ${profile.lastName}`.trim(),
      dto.shopId,
    );
  }

  @Get('me/conversations')
  @RequirePermission(Permission.MessageRead)
  @ApiOperation({ summary: 'Mes conversations.' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.messaging.listMine(user.id);
  }

  @Get('me/conversations/:id/messages')
  @RequirePermission(Permission.MessageRead)
  @ApiOperation({ summary: 'Historique d’une conversation.' })
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.messaging.listMessages(id, user.id, query.limit, query.cursor);
  }

  @Post('me/conversations/:id/messages')
  @RequirePermission(Permission.MessageSend)
  @ApiOperation({ summary: 'Envoyer un message.' })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messaging.sendMessage(id, user.id, dto.content);
  }
}
