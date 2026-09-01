import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';

import { AppError } from '../../common/http/app-error';
import { EventsGateway, RealtimeEvent } from '../realtime/events.gateway';
import { Order, type OrderDocument } from '../orders/schemas/order.schema';
import { Counter, type CounterDocument } from '../orders/schemas/counter.schema';
import { Invoice, type InvoiceDocument } from '../orders/schemas/invoice.schema';
import {
  PAYMENT_PROVIDERS,
  type PaymentProvider,
  type InitiateResult,
} from './payment-provider.interface';

/** Délai au-delà duquel une commande non payée est annulée — §14.3, étape 7. */
export const PAYMENT_TIMEOUT_MINUTES = 30;

/**
 * Corps attendu d'un rappel fournisseur, une fois la signature vérifiée.
 *
 * Aucun fournisseur réel n'est branché (§ décisions de portée, lot L2) : cette
 * forme est celle que MVola/Orange/Airtel documentent pour un rappel de
 * paiement marchand — elle ne change pas quand le vrai fournisseur arrive,
 * seule `verifyWebhookSignature` et l'appel HTTP sortant changeront.
 */
interface WebhookPayload {
  orderId: string;
  txId: string;
  status: 'paid' | 'failed';
  reference?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_PROVIDERS) private readonly providers: Map<string, PaymentProvider>,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Invoice.name) private readonly invoices: Model<InvoiceDocument>,
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
    private readonly gateway: EventsGateway,
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
   * Une fois authentifié, la commande, la facture et la notification temps
   * réel évoluent ensemble, dans une seule transaction — même motif que
   * `OrdersService.create` (§6.3) : un rappel qui échoue à mi-chemin ne doit
   * jamais laisser une commande « payée » sans facture.
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

    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as WebhookPayload;
    } catch {
      throw new AppError('INVALID_PAYLOAD', 'Corps de rappel illisible.', 400);
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const order = await this.orders.findById(payload.orderId).session(session);
        if (!order) throw AppError.notFound('Commande');

        // Rejeu d'un rappel déjà traité (livraison au moins une fois côté
        // fournisseur) : silencieux plutôt qu'une double facture.
        if (order.payment.status === 'paid' || order.payment.status === 'failed') return;

        order.payment.status = payload.status;
        order.payment.providerTxId = payload.txId;
        order.payment.reference = payload.reference;
        if (payload.status === 'paid') order.payment.paidAt = new Date();
        await order.save({ session });

        if (payload.status === 'paid') {
          const invoiceNumber = await this.generateInvoiceNumber(session);
          await this.invoices.create(
            [
              {
                invoiceNumber,
                orderId: order._id,
                shopId: order.shopId,
                userId: order.userId,
                customer: {
                  name: order.customer.name,
                  phone: order.customer.phone,
                  address: order.delivery.address,
                },
                items: order.items,
                amounts: order.amounts,
                status: 'paid',
                paymentMethod: order.payment.method,
                issuedAt: new Date(),
              },
            ],
            { session },
          );
        }

        this.gateway.emitToUser(String(order.userId), RealtimeEvent.OrderStatus, {
          orderId: String(order._id),
          paymentStatus: payload.status,
        });
      });
    } finally {
      await session.endSession();
    }

    return { received: true };
  }

  /** Même motif que `OrdersService::generateOrderNumber` — compteur atomique par année. */
  private async generateInvoiceNumber(session: ClientSession): Promise<string> {
    const year = new Date().getFullYear();
    const counter = await this.counters.findOneAndUpdate(
      { _id: `invoice:${year}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, session },
    );
    return `FAC-${year}-${String(counter.seq).padStart(4, '0')}`;
  }
}
