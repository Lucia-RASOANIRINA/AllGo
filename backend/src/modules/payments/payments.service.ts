import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { Order, type OrderDocument } from '../orders/schemas/order.schema';
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
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
  ) {}

  async initiate(orderId: string, provider: string, phone: string): Promise<InitiateResult> {
    const order = await this.orders.findById(orderId);
    if (!order) throw AppError.notFound('Commande');

    if (order.payment.status === 'paid') {
      throw new AppError('ALREADY_PAID', 'Cette commande est déjà payée.', 409);
    }

    const implementation = this.providers.get(provider);
    if (!implementation) {
      throw new AppError('PROVIDER_UNKNOWN', 'Ce moyen de paiement n’est pas disponible.', 400, {
        available: [...this.providers.keys()],
      });
    }

    const result = await implementation.initiate({
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      amount: String(order.amounts.total),
      phone,
    });

    order.payment.status = 'pending';
    order.payment.providerTxId = result.txId;
    order.payment.method = provider;
    await order.save();

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

    // TODO(L2) : mise à jour transactionnelle — `orders.payment` + `invoices`
    // + `auditLogs` dans une seule transaction MongoDB (§6.3), puis émission
    // Socket.IO et FCM vers le client et la boutique.
    return { received: true };
  }
}
