import { Injectable } from '@nestjs/common';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Paire clé/valeur, aplatie plutôt qu'un tableau de lignes : l'app mobile
   * lit `settings.maintenance_mode`, pas un tableau à filtrer côté client.
   */
  async getAll(): Promise<Record<string, string | null>> {
    const rows = await this.prisma.settings.findMany();
    return Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
  }

  async update(key: string, value: string): Promise<{ key: string; value: string }> {
    const existing = await this.prisma.settings.findUnique({ where: { setting_key: key } });
    if (!existing) {
      throw new AppError(
        'SETTING_NOT_FOUND',
        `Le paramètre « ${key} » n'existe pas — il doit être créé directement en base, pas via l'API.`,
        404,
      );
    }
    await this.prisma.settings.update({
      where: { setting_key: key },
      data: { setting_value: value },
    });
    return { key, value };
  }
}
