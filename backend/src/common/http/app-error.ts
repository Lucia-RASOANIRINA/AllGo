import { HttpStatus } from '@nestjs/common';

/**
 * Erreur métier — porte un code machine et un message **déjà localisé**.
 *
 * Le message est affiché tel quel par l'application Flutter (§7.2). Il doit
 * donc être rédigé en français correct, à destination d'un utilisateur final,
 * et jamais contenir de détail technique.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = HttpStatus.BAD_REQUEST,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(entity: string): AppError {
    return new AppError('NOT_FOUND', `${entity} introuvable.`, HttpStatus.NOT_FOUND);
  }

  static insufficientStock(productName: string, available: number, requested: number): AppError {
    return new AppError(
      'INSUFFICIENT_STOCK',
      `Stock insuffisant pour « ${productName} ».`,
      HttpStatus.CONFLICT,
      { available, requested },
    );
  }

  static invalidCredentials(): AppError {
    return new AppError(
      'INVALID_CREDENTIALS',
      'Numéro de téléphone ou mot de passe incorrect.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  static accountLocked(retryAfterSeconds: number): AppError {
    return new AppError(
      'ACCOUNT_LOCKED',
      'Trop de tentatives. Réessayez dans quelques minutes.',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfterSeconds },
    );
  }
}
