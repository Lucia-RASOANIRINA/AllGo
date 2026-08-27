import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Idempotence des créations — §7.1, §9.3.
 *
 * L'en-tête `Idempotency-Key` est obligatoire sur toute création de commande ou
 * de paiement. C'est ce qui garantit qu'une commande passée hors ligne, mise en
 * file locale puis rejouée à la reconnexion, ne crée jamais de doublon — le cas
 * le plus fréquent sur un réseau 3G intermittent.
 *
 * Trois états possibles pour une clé :
 *   - absente        → traitement, puis mémorisation de la réponse ;
 *   - « en cours »   → 409, le client réessaiera ;
 *   - réponse connue → renvoi de la réponse mémorisée, sans réexécution.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const key = request.headers[IDEMPOTENCY_HEADER];

    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Requête invalide. Réessayez depuis l’application.',
      });
    }

    const userId = request.user?.id ?? 'anonymous';
    const redisKey = `idem:${userId}:${request.method}:${request.route?.path ?? request.url}:${key}`;

    return from(this.redis.get(redisKey)).pipe(
      switchMap((cached) => {
        if (cached === 'in-flight') {
          throw new ConflictException({
            code: 'REQUEST_IN_FLIGHT',
            message: 'Cette demande est déjà en cours de traitement.',
          });
        }
        if (cached) return of(JSON.parse(cached));

        // `NX` : pose le verrou seulement si la clé est libre — atomique.
        return from(this.redis.set(redisKey, 'in-flight', 'EX', 300, 'NX')).pipe(
          switchMap((acquired) => {
            if (acquired === null) {
              throw new ConflictException({
                code: 'REQUEST_IN_FLIGHT',
                message: 'Cette demande est déjà en cours de traitement.',
              });
            }
            return next.handle().pipe(
              tap({
                next: (result) => {
                  void this.redis.set(redisKey, JSON.stringify(result), 'EX', TTL_SECONDS);
                },
                // Un échec libère la clé : le client doit pouvoir réessayer.
                error: () => void this.redis.del(redisKey),
              }),
            );
          }),
        );
      }),
    );
  }
}
