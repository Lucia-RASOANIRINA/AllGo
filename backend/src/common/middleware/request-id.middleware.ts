import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Corrélation par identifiant de requête — §4.2 (observabilité).
 *
 * Le même `requestId` traverse le journal HTTP, les jobs BullMQ, les requêtes
 * MongoDB et le corps d'erreur renvoyé au client. Un utilisateur qui signale un
 * problème donne son `requestId` ; la trace complète est retrouvée en une
 * recherche.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  }
}
