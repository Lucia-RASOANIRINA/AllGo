import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { CurrentUser, Public, RequirePermission } from '../../common/decorators/auth.decorators';
import { Permission } from '../../common/rbac/permissions';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  SendOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto';

/** Limitation renforcée sur l'authentification : 10 req/min (§7.1). */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Authentification')
@Controller('auth')
@Throttle(AUTH_THROTTLE)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Créer un compte client.' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ouvrir une session par numéro et mot de passe.' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renouveler le jeton d’accès.',
    description:
      'Le jeton de rafraîchissement est rotatif : le jeton présenté est révoqué ' +
      'et remplacé. Réutiliser un jeton déjà consommé invalide toute la chaîne.',
  })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.SessionManage)
  @ApiOperation({ summary: 'Fermer la session courante.' })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    if (user.sid) await this.auth.logout(user.sid);
  }

  @Public()
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envoyer un code SMS à 6 chiffres, valide 5 minutes.' })
  sendOtp(@Body() dto: SendOtpDto) {
    return this.auth.sendOtp(dto.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifier le code SMS et ouvrir une session.' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Demander une réinitialisation de mot de passe.',
    description:
      'La réponse est identique que le compte existe ou non : l’API ne permet ' +
      'jamais d’énumérer les comptes enregistrés.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.phone);
    return { message: 'Si un compte existe, un SMS de réinitialisation a été envoyé.' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Définir un nouveau mot de passe et fermer toutes les sessions.' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
    return { message: 'Mot de passe modifié. Reconnectez-vous.' };
  }
}
