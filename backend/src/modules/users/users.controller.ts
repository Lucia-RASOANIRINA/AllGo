import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RegisterDeviceDto } from '../auth/dto/auth.dto';
import { UsersService } from './users.service';
import { CreateAddressDto, UpdateProfileDto } from './dto/profile.dto';

@ApiTags('Profil')
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({ summary: 'Consulter mon profil et mes rôles.' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.findById(user.id);
  }

  @Patch()
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({ summary: 'Modifier mon profil.' })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Delete()
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({
    summary: 'Supprimer mon compte.',
    description: 'Anonymise le profil et révoque toutes les sessions. Irréversible.',
  })
  deleteAccount(@CurrentUser() user: AuthenticatedUser) {
    return this.users.deleteAccount(user.id);
  }

  @Get('addresses')
  @RequirePermission(Permission.ProfileRead)
  @ApiOperation({ summary: 'Lister mes adresses de livraison.' })
  addresses(@CurrentUser() user: AuthenticatedUser) {
    return this.users.listAddresses(user.id);
  }

  @Post('addresses')
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({ summary: 'Ajouter une adresse.' })
  addAddress(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAddressDto) {
    return this.users.addAddress(user.id, dto);
  }

  @Delete('addresses/:id')
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({ summary: 'Supprimer une adresse.' })
  removeAddress(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.users.removeAddress(user.id, id);
  }

  @Post('devices')
  @RequirePermission(Permission.ProfileUpdate)
  @ApiOperation({
    summary: 'Enregistrer ce terminal pour les notifications push.',
    description:
      'Appelé au démarrage et à chaque rotation du jeton FCM. Idempotent par `deviceId`.',
  })
  registerDevice(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.users.registerDevice(user.id, dto);
  }
}
