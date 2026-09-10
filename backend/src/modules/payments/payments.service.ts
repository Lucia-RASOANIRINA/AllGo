import { Inject, Injectable, Logger } from '@nestjs/common';

import { AppError } from '../../common/http/app-error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type InitiateResult,
} from './payment-provider.interface';

/** Délai au-delà duquel une commande non payée est annulée — §14.3, étape 7. */
export const PAYMENT_TIMEOUT_MINUTES = 30;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_PROVIDERS) private readonly providers: Map<string, PaymentProvider>,
    private readonly prisma: PrismaService,
  ) {}

  /** Accès direct à un fournisseur — utilisé par `GET /payments/methods` pour refléter sa disponibilité réelle. */
  provider(name: string): PaymentProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * `Order.payment` (sous-document Mongo) a migré vers MySQL (Phase 3) : une
   * ligne `payments` par tentative (jamais réécrite), plus les colonnes
   * `orders.payment_status`/`payment_method` qui portent l'état courant.
   */
  async initiate(
    orderId: string,
    userMysqlId: number,
    provider: string,
    phone: string,
  ): Promise<InitiateResult> {
    const order = await this.prisma.orders.findFirst({
      where: { id: Number(orderId), user_id: userMysqlId },
    });
    if (!order) throw AppError.notFound('Commande');

    if (order.payment_status === 'paid') {
      throw new AppError('ALREADY_PAID', 'Cette commande est déjà payée.', 409);
    }

    const implementation = this.providers.get(provider);
    if (!implementation) {
      throw new AppError('PROVIDER_UNKNOWN', 'Ce moyen de paiement n’est pas disponible.', 400, {
        available: [...this.providers.keys()],
      });
    }

    const result = await implementation.initiate({
      orderId: String(order.id),
      orderNumber: order.order_number,
      amount: String(order.total_amount),
      phone,
    });

    await this.prisma.$transaction([
      this.prisma.payments.create({
        data: {
          order_id: order.id,
          method: provider,
          transaction_ref: result.txId,
          amount: order.total_amount,
          status: 'pending',
        },
      }),
      this.prisma.orders.update({
        where: { id: order.id },
        data: { payment_method: provider as never },
      }),
    ]);

    return result;
  }

  /**
   * Traitement d'un rappel fournisseur — §14.3, étape 5.
   *
   * La signature est vérifiée AVANT toute lecture du contenu : un rappel non
   * authentifié n'est qu'une requête anonyme affirmant qu'une commande est payée.
   */
  async handleWebhook(
    providerName: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<{ received: true }> {
    const provider = this.providers.get(providerName);
    if (!provider) throw AppError.notFound('Fournisseur de paiement');

    if (!provider.verifyWebhookSignature(rawBody, headers)) {
      this.logger.error({ provider: providerName }, 'Signature de rappel invalide — rejeté');
      throw new AppError('INVALID_SIGNATURE', 'Requête refusée.', 401);
    }

    let payload: { txId?: string; status?: string; reference?: string };
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as typeof payload;
    } catch {
      throw new AppError('INVALID_PAYLOAD', 'Corps de rappel invalide.', 400);
    }

    if (!payload.txId || !payload.status) {
      throw new AppError('INVALID_PAYLOAD', 'Le rappel de paiement est incomplet.', 400);
    }

    const payment = await this.prisma.payments.findFirst({
      where: { transaction_ref: payload.txId },
      orderBy: { id: 'desc' },
    });
    if (!payment) throw AppError.notFound('Transaction');

    /**
     * `payments.status` (par tentative) n'a que 3 valeurs (pending/success/
     * failed) — `cancelled` n'existe pas à ce niveau, seul `orders.payment_status`
     * distingue `unpaid`/`paid`/`refunded`. Un rappel « cancelled » ramène donc
     * la tentative à `failed` (l'utilisateur peut en retenter une autre).
     */
    const paymentStatusMap = { pending: 'pending', paid: 'success', failed: 'failed', cancelled: 'failed' } as const;
    const orderStatusMap = { pending: 'unpaid', paid: 'paid', failed: 'unpaid', cancelled: 'unpaid' } as const;
    const nextPaymentStatus = paymentStatusMap[payload.status as keyof typeof paymentStatusMap];
    if (!nextPaymentStatus) throw new AppError('INVALID_PAYLOAD', 'Statut de paiement inconnu.', 400);

    const order = await this.prisma.orders.findUnique({ where: { id: payment.order_id } });
    if (!order) throw AppError.notFound('Commande');

    // Idempotence : un rappel déjà appliqué ne modifie plus l'état final.
    if (order.payment_status !== 'paid' && order.payment_status !== 'refunded') {
      await this.prisma.$transaction([
        this.prisma.payments.update({ where: { id: payment.id }, data: { status: nextPaymentStatus } }),
        this.prisma.orders.update({
          where: { id: order.id },
          data: { payment_status: orderStatusMap[payload.status as keyof typeof orderStatusMap] },
        }),
      ]);
    }
    return { received: true };
  }
}
