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

@Injectable()
export class AirtelMoneyProvider implements PaymentProvider {
  readonly name = 'airtel_money' as const;
  private readonly logger = new Logger(AirtelMoneyProvider.name);

  constructor(private readonly config: ConfigService) {}

  private demoModeAllowed(): boolean {
    return this.config.get('env') !== 'production' && this.config.get('PAYMENTS_DEMO_MODE') === 'true';
  }

  isAvailable(): boolean {
    return Boolean(this.config.get('AIRTEL_MONEY_CONSUMER_KEY')) || this.demoModeAllowed();
  }

  async initiate(context: PaymentContext): Promise<InitiateResult> {
    if (this.demoModeAllowed() && !this.config.get('AIRTEL_MONEY_CONSUMER_KEY')) {
      return {
        txId: `demo-airtel-${Date.now()}`,
        ussdCode: `*555*${context.amount}#`,
      };
    }

    this.assertConfigured();
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      'Le paiement Airtel Money est momentanément indisponible. Choisissez un autre mode de paiement.',
      503,
      { provider: this.name, orderNumber: context.orderNumber },
    );
  }

  async verify(txId: string): Promise<PaymentStatus> {
    if (this.demoModeAllowed() && !this.config.get('AIRTEL_MONEY_CONSUMER_KEY')) {
      return { status: 'paid', providerTxId: txId, paidAt: new Date() };
    }

    this.assertConfigured();
    return { status: 'pending', providerTxId: txId };
  }

  async refund(txId: string, amount: string): Promise<RefundResult> {
    this.logger.warn({ txId, amount }, 'Remboursement Airtel Money non encore implémenté');
    throw new AppError(
      'REFUND_NOT_SUPPORTED',
      'Le remboursement automatique n’est pas encore disponible pour ce moyen de paiement.',
      501,
    );
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean {
    const secret = this.config.get<string>('AIRTEL_MONEY_WEBHOOK_SECRET');
    const received = headers['x-airtel-signature'];
    if (!secret || !received) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private assertConfigured(): void {
    if (!this.config.get('AIRTEL_MONEY_CONSUMER_KEY')) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        'Ce moyen de paiement n’est pas encore disponible.',
        503,
      );
    }
  }
}
