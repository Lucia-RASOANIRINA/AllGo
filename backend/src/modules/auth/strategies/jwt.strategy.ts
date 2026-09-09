import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { buildRoleAssignments } from '../../users/mysql-role-mapper';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';

interface AccessTokenClaims {
  sub: string;
  mysqlId: number;
  phone: string;
  sid: string;
  iat: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  /**
   * Les rôles et le statut proviennent de MySQL à chaque requête, jamais du
   * jeton : une révocation de rôle ou une suspension prend effet à la requête
   * suivante, pas à l'expiration du jeton (comportement inchangé de l'ancienne
   * implémentation Mongo).
   */
  async validate(claims: AccessTokenClaims): Promise<AuthenticatedUser> {
    const user = await this.prisma.users.findUnique({ where: { id: claims.mysqlId } });

    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'Votre session n’est plus valide. Reconnectez-vous.',
      });
    }

    // Un jeton d'accès émis avant une réinitialisation de mot de passe est
    // rejeté immédiatement, sans attendre ses 15 minutes de validité.
    if (user.sessions_invalid_before && claims.iat * 1000 < user.sessions_invalid_before.getTime()) {
      throw new UnauthorizedException({
        code: 'SESSION_INVALIDATED',
        message: 'Votre session n’est plus valide. Reconnectez-vous.',
      });
    }

    const [ownedShops, teamMembership] = await Promise.all([
      this.prisma.shops.findMany({ where: { user_id: user.id }, select: { id: true } }),
      this.prisma.shop_team_members.findUnique({ where: { user_id: user.id } }),
    ]);
    const roles = buildRoleAssignments({
      roleId: user.role_id,
      adminLevel: user.admin_level,
      ownedShopIds: ownedShops.map((s) => s.id),
      teamMembership: teamMembership
        ? { shopId: teamMembership.shop_id, teamRole: teamMembership.team_role, status: teamMembership.status }
        : null,
    });

    return {
      id: claims.sub,
      mysqlId: user.id,
      phone: user.phone ?? claims.phone,
      roles,
      sid: claims.sid,
    };
  }
}
