import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import { AdminLogsService } from './admin-logs.service';

@ApiTags('Administration')
@Controller('admin/logs')
export class AdminLogsController {
  constructor(private readonly adminLogs: AdminLogsService) {}

  @Get()
  @RequirePermission(Permission.AuditRead)
  @ApiOperation({ summary: "Journal d'audit des actions d'administration." })
  list(@Query('limit') limit?: string) {
    return this.adminLogs.list(limit ? Number(limit) : undefined);
  }
}
