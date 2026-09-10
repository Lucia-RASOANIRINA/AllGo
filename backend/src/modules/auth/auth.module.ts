import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';

import { User, UserSchema } from '../users/schemas/user.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Secrets fournis à l'appel (`signAsync`) : accès et rafraîchissement
    // utilisent deux clés distinctes, ce qui interdit d'employer un jeton de
    // rafraîchissement comme jeton d'accès.
    JwtModule.register({}),
    // `User` reste enregistré : ce module tient à jour le miroir Mongo
    // (`AuthService.mirrorUser`) pour les modules pas encore migrés sur
    // MySQL (`PrismaModule`, `@Global()`, fournit `PrismaService` sans
    // import explicite). `RefreshToken` (Mongo) a été remplacé par la table
    // MySQL réelle `refresh_tokens` — son schéma Mongo n'est plus utilisé.
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, EmailService, SmsService],
  exports: [AuthService],
})
export class AuthModule {}
