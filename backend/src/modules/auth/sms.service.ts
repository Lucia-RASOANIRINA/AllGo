import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppError } from '../../common/http/app-error';

/**
 * Passerelle SMS — §12.2. Aucun fournisseur réel n'est encore branché (le
 * contrat d'appel HTTP générique sera rempli au lot L2, même motif que les
 * fournisseurs mobile money : `payments/providers/*.provider.ts`).
 *
 * `assertAvailable()` doit être appelée EN TÊTE de toute méthode qui dépend
 * d'un envoi réel (`sendOtp`, `forgotPassword`) — avant toute écriture Redis,
 * pour ne jamais générer un code que personne ne recevra jamais.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  assertAvailable(): void {
    if (this.config.get<string>('sms.gatewayUrl')) return;

    if (this.config.get<string>('env') !== 'production') return;

    throw new AppError(
      'SMS_GATEWAY_UNAVAILABLE',
      "L'envoi de SMS n'est pas encore disponible sur AllGo. Cette fonctionnalité arrive très bientôt — connectez-vous avec votre mot de passe.",
      503,
    );
  }

  async send(phone: string, message: string): Promise<void> {
    const gatewayUrl = this.config.get<string>('sms.gatewayUrl');

    if (!gatewayUrl) {
      // `assertAvailable()` a déjà bloqué ce chemin en production — ne reste
      // ici que le développement local, où le message est journalisé.
      this.logger.debug(`SMS pour ${phone} : ${message}`);
      return;
    }

    // TODO(L2) : appel HTTP réel vers le fournisseur choisi (URL/clé déjà
    // configurables via `SMS_GATEWAY_URL`/`SMS_GATEWAY_API_KEY`/`SMS_SENDER_ID`).
    throw new AppError('SMS_GATEWAY_UNAVAILABLE', "L'envoi de SMS n'est pas encore disponible sur AllGo.", 503);
  }
}
