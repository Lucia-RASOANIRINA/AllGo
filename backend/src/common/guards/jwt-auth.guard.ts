import { ExecutionContext, Injectable } from '@nestjs/common';
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
}
