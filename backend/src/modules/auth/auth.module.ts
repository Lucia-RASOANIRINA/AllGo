import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/** 100 % MySQL depuis la Phase 6 — plus de miroir Mongo `User` à tenir à jour. */
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Secrets fournis à l'appel (`signAsync`) : accès et rafraîchissement
    // utilisent deux clés distinctes, ce qui interdit d'employer un jeton de
    // rafraîchissement comme jeton d'accès.
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, EmailService, SmsService],
  exports: [AuthService],
})
export class AuthModule {}
