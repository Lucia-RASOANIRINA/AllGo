import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsArray, IsNumberString, IsOptional } from 'class-validator';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { NotificationsService } from './notifications.service';

export class MarkReadDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Identifiants numériques MySQL à marquer comme lus. Omis : toutes les notifications non lues.',
  })
  @IsOptional()
  @IsArray()
  @IsNumberString({}, { each: true })
  ids?: string[];
}

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermission(Permission.NotificationRead)
  @ApiOperation({ summary: 'Lister mes notifications.' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.notifications.list(user.mysqlId, query.limit, query.cursor);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.NotificationRead)
  @ApiOperation({ summary: 'Marquer des notifications comme lues.' })
  markRead(@CurrentUser() user: AuthenticatedUser, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(user.mysqlId, dto.ids);
  }
}
