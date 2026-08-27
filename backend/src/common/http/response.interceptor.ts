import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

import { normaliseResponse } from './serialisation';

/** Résultat paginé renvoyé par un service — enveloppé en `{ data, meta }`. */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

function isPaginated(value: unknown): value is Paginated<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Paginated<unknown>).items) &&
    'hasMore' in value
  );
}

/**
 * Enveloppe uniforme des réponses — §7.2.
 *
 *   { "data": … , "meta": { "nextCursor": …, "hasMore": … } }
 *
 * Le client mobile n'a jamais à deviner la forme d'une réponse.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const requestId = context.switchToHttp().getRequest()?.id;

    return next.handle().pipe(
      map((payload) => {
        if (payload && typeof payload === 'object' && 'data' in payload && 'meta' in payload) {
          return payload; // déjà enveloppé par le contrôleur
        }
        if (isPaginated(payload)) {
          return {
            data: normaliseResponse(payload.items),
            meta: { nextCursor: payload.nextCursor, hasMore: payload.hasMore, requestId },
          };
        }
        return { data: normaliseResponse(payload) ?? null, meta: { requestId } };
      }),
    );
  }
}
