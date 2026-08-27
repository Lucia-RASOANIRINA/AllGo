import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Numéro malgache : +261 suivi de 9 chiffres, ou 0 suivi de 9 chiffres.
 * Normalisé en `+261XXXXXXXXX` par `AuthService.normalisePhone`.
 */
const MG_PHONE = /^(\+261|0)[23][0-9]{8}$/;

/**
 * Politique de mot de passe — §12.1.
 * 10 caractères minimum (le web en exigeait 6), au moins une lettre et un
 * chiffre. La vérification contre les listes de mots de passe compromis est
 * faite en plus, côté service.
 */
const PASSWORD_RULE = /^(?=.*[A-Za-zÀ-ÿ])(?=.*\d).{10,128}$/;

export class RegisterDto {
  @ApiProperty({ example: '+261341234567' })
  @Matches(MG_PHONE, { message: 'Le numéro de téléphone n’est pas valide.' })
  phone!: string;

  @ApiPropertyOptional({ example: 'utilisateur@example.mg' })
  @IsOptional()
  @IsEmail({}, { message: 'L’adresse email n’est pas valide.' })
  email?: string;

  @ApiProperty({ minLength: 10, description: '10 caractères minimum, lettres et chiffres.' })
  @Matches(PASSWORD_RULE, {
    message: 'Le mot de passe doit contenir au moins 10 caractères, dont une lettre et un chiffre.',
  })
  password!: string;

  @ApiProperty({ example: 'Soloniaina' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  firstName!: string;

  @ApiProperty({ example: 'Jaonarison' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  lastName!: string;
}

export class LoginDto {
  @ApiProperty({ example: '+261341234567' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiPropertyOptional({
    description: 'Identifiant stable du terminal, pour la gestion des sessions.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class SendOtpDto {
  @ApiProperty({ example: '+261341234567' })
  @Matches(MG_PHONE, { message: 'Le numéro de téléphone n’est pas valide.' })
  phone!: string;

  @ApiPropertyOptional({ enum: ['login', 'verify', 'reset'], default: 'login' })
  @IsOptional()
  @IsIn(['login', 'verify', 'reset'])
  purpose?: 'login' | 'verify' | 'reset';
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+261341234567' })
  @IsString()
  phone!: string;

  @ApiProperty({ example: '123456', description: 'Code à 6 chiffres, valide 5 minutes.' })
  @Matches(/^\d{6}$/, { message: 'Le code doit contenir 6 chiffres.' })
  code!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: '+261341234567' })
  @IsString()
  phone!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ minLength: 10 })
  @Matches(PASSWORD_RULE, {
    message: 'Le mot de passe doit contenir au moins 10 caractères, dont une lettre et un chiffre.',
  })
  password!: string;
}

export class RegisterDeviceDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fcmToken!: string;

  @ApiProperty({ enum: ['android', 'ios'] })
  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';
}
