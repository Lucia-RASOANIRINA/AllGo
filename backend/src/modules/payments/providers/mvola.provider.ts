import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { AppError } from '../../../common/http/app-error';
import type {
  InitiateResult,
  PaymentContext,
  PaymentProvider,
  PaymentStatus,
  RefundResult,
} from '../payment-provider.interface';

/**
 * MVola (Telma) — environ 50 % du marché à Mahajanga (§14.1).
 *
 * ÉTAT : ossature. Les appels réels seront branchés au lot L2, une fois les
 * accès du portail développeur MVola obtenus. Le contrat d'interface, lui, est
 * figé dès maintenant : le reste du code n'aura pas à changer.
 */
@Injectable()
export class MvolaProvider implements PaymentProvider {
  readonly name = 'mvola' as const;
  private readonly logger = new Logger(MvolaProvider.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Mode démo : succès simulé sans appel réseau, RÉSERVÉ au développement et
   * seulement si explicitement autorisé — un `NODE_ENV` mal positionné ne
   * doit jamais, à lui seul, ouvrir une faille financière (§ décision du
   * 2026-09-09, mise en marché).
   */
  private demoModeAllowed(): boolean {
    return this.config.get('env') !== 'production' && this.config.get('PAYMENTS_DEMO_MODE') === 'true';
  }

  isAvailable(): boolean {
    return Boolean(this.config.get('MVOLA_CONSUMER_KEY')) || this.demoModeAllowed();
  }

  async initiate(context: PaymentContext): Promise<InitiateResult> {
    if (this.demoModeAllowed() && !this.config.get('MVOLA_CONSUMER_KEY')) {
      return {
        txId: `demo-mvola-${Date.now()}`,
        ussdCode: `*999*${context.amount}#`,
      };
    }

    this.assertConfigured();
    // TODO(L2) : POST /mvola/mm/transactions/type/merchantpay/1.0.0/
    //   en-têtes : Authorization Bearer, X-CorrelationID, UserLanguage: FR,
    //   partnerName, callbackUrl.
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      'Le paiement MVola est momentanément indisponible. Choisissez un autre mode de paiement.',
      503,
      { provider: this.name, orderNumber: context.orderNumber },
    );
  }

  async verify(txId: string): Promise<PaymentStatus> {
    if (this.demoModeAllowed() && !this.config.get('MVOLA_CONSUMER_KEY')) {
      return { status: 'paid', providerTxId: txId, paidAt: new Date() };
    }

    this.assertConfigured();
    // TODO(L2) : GET /mvola/mm/transactions/type/merchantpay/1.0.0/status/{txId}
    return { status: 'pending', providerTxId: txId };
  }

  async refund(txId: string, amount: string): Promise<RefundResult> {
    this.assertConfigured();
    this.logger.warn({ txId, amount }, 'Remboursement MVola non encore implémenté');
    throw new AppError(
      'REFUND_NOT_SUPPORTED',
      'Le remboursement automatique n’est pas encore disponible pour ce moyen de paiement.',
      501,
    );
  }

  /**
   * HMAC-SHA256 sur le corps BRUT.
   *
   * Le corps doit être celui reçu, octet pour octet : sérialiser puis
   * re-sérialiser le JSON change les espaces et invalide toute signature.
   */
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean {
    const secret = this.config.get<string>('MVOLA_WEBHOOK_SECRET');
    const received = headers['x-mvola-signature'];
    if (!secret || !received) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private assertConfigured(): void {
    if (!this.config.get('MVOLA_CONSUMER_KEY')) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        'Ce moyen de paiement n’est pas encore disponible.',
        503,
      );
    }
  }
}
