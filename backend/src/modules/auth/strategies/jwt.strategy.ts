import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Model } from 'mongoose';
import { User, type UserDocument } from '../../users/schemas/user.schema';
import type { AuthenticatedUser, RoleAssignment } from '../../../common/types/authenticated-user';

interface AccessTokenClaims {
  sub: string;
  phone: string;
  roles: RoleAssignment[];
  sid: string;
  iat: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  async validate(claims: AccessTokenClaims): Promise<AuthenticatedUser> {
    const user = await this.users
      .findById(claims.sub)
      .select('status roles phone sessionsInvalidBefore')
      .lean();

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'Votre session n’est plus valide. Reconnectez-vous.',
      });
    }

    // Un jeton d'accès émis avant une réinitialisation de mot de passe est
    // rejeté immédiatement, sans attendre ses 15 minutes de validité.
    if (user.sessionsInvalidBefore && claims.iat * 1000 < user.sessionsInvalidBefore.getTime()) {
      throw new UnauthorizedException({
        code: 'SESSION_INVALIDATED',
        message: 'Votre session n’est plus valide. Reconnectez-vous.',
      });
    }

    // Les rôles proviennent de la base, jamais du jeton : une révocation de
    // rôle prend effet à la requête suivante, et non à l'expiration du jeton.
    return {
      id: String(user._id),
      phone: user.phone ?? '',
      roles: user.roles.map((r) => ({
        role: r.role,
        ...(r.shopId ? { shopId: String(r.shopId) } : {}),
      })),
      sid: claims.sid,
    };
  }
}
