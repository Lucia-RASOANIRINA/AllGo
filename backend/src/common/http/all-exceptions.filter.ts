import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error';

/**
 * Filtre d'exceptions global — §7.2.
 *
 * Garantit que le corps d'erreur porte toujours un `code` machine, un `message`
 * **prêt à afficher et déjà localisé**, et un `requestId` corrélant la trace
 * serveur. Le client mobile ne compose jamais de texte d'erreur métier lui-même.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const requestId = request.id ?? null;

    const { status, code, message, details } = this.normalise(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // `Logger.error(message, stack)` — et non un objet en premier argument :
      // la signature pino ne produit ici qu'un objet sérialisé sans pile, donc
      // une erreur 500 illisible au moment précis où elle doit être lisible.
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} → ${code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({ error: { code, message, details, requestId } });
  }

  private normalise(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;

        // Échec de validation class-validator : `message` est un tableau.
        if (Array.isArray(record.message)) {
          return {
            status,
            code: 'VALIDATION_FAILED',
            message: 'Certains champs sont invalides.',
            details: { fields: record.message },
          };
        }

        return {
          status,
          code: (record.code as string) ?? this.defaultCode(status),
          message: (record.message as string) ?? exception.message,
          details: record.details,
        };
      }

      return { status, code: this.defaultCode(status), message: exception.message };
    }

    // Toute autre exception : aucun détail interne ne fuit vers le client.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: "Une erreur inattendue s'est produite. Réessayez dans un instant.",
    };
  }

  private defaultCode(status: number): string {
    const codes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE',
      429: 'RATE_LIMITED',
    };
    return codes[status] ?? 'ERROR';
  }
}
