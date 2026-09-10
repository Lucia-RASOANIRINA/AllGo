import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type Redis from 'ioredis';

import { Public } from '../../common/decorators/auth.decorators';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.constants';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@ApiTags('Exploitation')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Sonde de disponibilité (supervision externe).' })
  async health() {
    const [mysql, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'connected' as const).catch(() => 'disconnected' as const),
      this.redis.ping().then(() => 'connected' as const).catch(() => 'disconnected' as const),
    ]);
    return {
      status: mysql === 'connected' && redis === 'connected' ? 'ok' : 'degraded',
      mysql,
      redis,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  /**
   * Mise à jour forcée — §17.3.
   *
   * L'application compare sa version à `minSupportedVersion` au démarrage. Une
   * version antérieure affiche un écran bloquant : c'est le seul moyen de
   * retirer du parc une version comportant une faille ou une incompatibilité
   * de schéma, puisqu'un utilisateur ne met pas à jour spontanément.
   */
  @Public()
  @Get('app-config')
  @ApiOperation({ summary: 'Configuration côté client : version minimale supportée, drapeaux.' })
  appConfig() {
    return {
      minSupportedVersion: this.config.getOrThrow<string>('minSupportedAppVersion'),
      features: {
        mobileMoney: false, // activé au lot L2
        realtimeDelivery: false, // activé au lot L6
      },
      // Heures calmes : aucune notification non critique entre 21 h et 7 h (§10.2).
      quietHours: { start: '21:00', end: '07:00', timezone: 'Indian/Antananarivo' },
    };
  }
}
