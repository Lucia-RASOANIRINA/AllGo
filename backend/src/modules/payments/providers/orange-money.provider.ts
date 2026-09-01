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
export class OrangeMoneyProvider implements PaymentProvider {
  readonly name = 'orange_money' as const;
  private readonly logger = new Logger(OrangeMoneyProvider.name);

  constructor(private readonly config: ConfigService) {}

  async initiate(context: PaymentContext): Promise<InitiateResult> {
    if (!this.config.get('ORANGE_MONEY_CONSUMER_KEY')) {
      return {
        txId: `demo-orange-${Date.now()}`,
        ussdCode: `*888*${context.amount}#`,
      };
    }

    this.assertConfigured();
    throw new AppError(
      'PROVIDER_UNAVAILABLE',
      'Le paiement Orange Money est momentanément indisponible. Choisissez un autre mode de paiement.',
      503,
      { provider: this.name, orderNumber: context.orderNumber },
    );
  }

  async verify(txId: string): Promise<PaymentStatus> {
    if (!this.config.get('ORANGE_MONEY_CONSUMER_KEY')) {
      return { status: 'paid', providerTxId: txId, paidAt: new Date() };
    }

    this.assertConfigured();
    return { status: 'pending', providerTxId: txId };
  }

  async refund(txId: string, amount: string): Promise<RefundResult> {
    this.logger.warn({ txId, amount }, 'Remboursement Orange Money non encore implémenté');
    throw new AppError(
      'REFUND_NOT_SUPPORTED',
      'Le remboursement automatique n’est pas encore disponible pour ce moyen de paiement.',
      501,
    );
  }

  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean {
    const secret = this.config.get<string>('ORANGE_MONEY_WEBHOOK_SECRET');
    const received = headers['x-orange-signature'];
    if (!secret || !received) return false;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private assertConfigured(): void {
    if (!this.config.get('ORANGE_MONEY_CONSUMER_KEY')) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        'Ce moyen de paiement n’est pas encore disponible.',
        503,
      );
    }
  }
}
