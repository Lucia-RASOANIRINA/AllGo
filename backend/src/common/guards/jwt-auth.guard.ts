import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PUBLIC_KEY } from '../decorators/auth.decorators';

/**
 * Garde d'authentification appliqué GLOBALEMENT (`APP_GUARD`).
 *
 * Sécurité par défaut : toute route est authentifiée, sauf `@Public()`.
 * C'est l'inverse exact du modèle web actuel, où 30 routes d'administration
 * n'étaient protégées que par l'existence d'une session.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /**
   * Un jeton absent, malformé ou expiré échoue dans passport-jwt lui-même,
   * avant même `JwtStrategy.validate()` — ses messages français (§ jeton
   * invalidé) ne s'appliquent donc pas ici. Sans cette surcharge, le
   * comportement par défaut de `AuthGuard` renvoie `new UnauthorizedException()`
   * avec le message anglais générique "Unauthorized", qui fuit tel quel
   * jusqu'au client mobile (§7.2 : tout message doit être déjà affichable).
   */
  handleRequest<TUser = unknown>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Votre session a expiré. Reconnectez-vous.',
      });
    }
    return user;
  }
}
