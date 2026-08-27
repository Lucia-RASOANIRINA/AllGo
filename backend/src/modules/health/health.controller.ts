import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';

import { Public } from '../../common/decorators/auth.decorators';

@ApiTags('Exploitation')
@Controller()
export class HealthController {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Sonde de disponibilité (supervision externe).' })
  health() {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    return {
      status: this.connection.readyState === 1 ? 'ok' : 'degraded',
      mongo: states[this.connection.readyState] ?? 'unknown',
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
