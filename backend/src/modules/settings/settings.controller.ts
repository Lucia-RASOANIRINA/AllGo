import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import { UpdateSettingDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('Paramètres')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Paramètres globaux publics (mode maintenance, contacts, etc.).' })
  getAll() {
    return this.settings.getAll();
  }

  @Patch(':key')
  @RequirePermission(Permission.PlatformSettings)
  @ApiOperation({ summary: 'Modifier un paramètre existant — modération plateforme.' })
  update(@Param('key') key: string, @Body() dto: UpdateSettingDto) {
    return this.settings.update(key, dto.value);
  }
}
