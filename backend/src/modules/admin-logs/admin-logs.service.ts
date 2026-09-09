import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

/**
 * Journal d'audit — table MySQL réelle `admin_logs`, jusqu'ici sans
 * équivalent mobile (aucune action d'administration n'était tracée).
 *
 * `admin_id` référence un entier MySQL alors que le JWT porte un ObjectId
 * Mongo : on résout via `PrismaService.resolveUserId` (pont téléphone, même
 * mécanisme que `KycService`). `target_id` est un entier MySQL et ne peut pas
 * porter un ObjectId Mongo — pour une cible Mongo, l'identifiant complet est
 * donc inclus dans `action` plutôt que forcé dans une colonne qui ne peut pas
 * le représenter.
 *
 * Best-effort : une écriture de journal qui échoue (admin non résolu, base
 * indisponible) ne doit jamais faire échouer l'action réelle qu'elle décrit.
 */
@Injectable()
export class AdminLogsService {
  private readonly logger = new Logger(AdminLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(admin: AuthenticatedUser, action: string, targetType?: string): Promise<void> {
    try {
      const adminId = await this.prisma.resolveUserId(admin.phone);
      await this.prisma.admin_logs.create({
        data: { admin_id: adminId, action, target_type: targetType ?? null },
      });
    } catch (error) {
      this.logger.warn(`Écriture admin_logs ignorée pour "${action}" : ${(error as Error).message}`);
    }
  }

  list(limit = 200) {
    return this.prisma.admin_logs.findMany({
      orderBy: { created_at: 'desc' },
      take: limit,
      include: { users: { select: { id: true, phone: true, firstname: true, lastname: true } } },
    });
  }
}
