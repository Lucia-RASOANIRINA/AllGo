/**
 * Abstraction des fournisseurs mobile money — §14.2.
 *
 * Une interface unique, une implémentation par fournisseur. C'est la mesure de
 * maîtrise du risque R2 : les API de MVola, Orange Money et Airtel Money sont
 * instables et inégalement documentées. Le reste du code n'en dépend jamais
 * directement, et le mode dégradé (§14.4) se substitue sans toucher au métier.
 */

export type PaymentStatusValue = 'pending' | 'paid' | 'failed' | 'cancelled';

export interface InitiateResult {
  /** Identifiant de transaction chez le fournisseur. */
  txId: string;
  /** Page de confirmation à ouvrir, si le fournisseur en propose une. */
  redirectUrl?: string;
  /** Code USSD à composer, forme la plus fiable sur les terminaux modestes. */
  ussdCode?: string;
}

export interface PaymentStatus {
  status: PaymentStatusValue;
  providerTxId: string;
  paidAt?: Date;
  failureReason?: string;
}

export interface RefundResult {
  refundId: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface PaymentContext {
  orderId: string;
  orderNumber: string;
  /** Montant en Ariary, en chaîne : aucun flottant ne touche jamais un montant. */
  amount: string;
  /** Numéro payeur, normalisé en `+261XXXXXXXXX`. */
  phone: string;
}

export interface PaymentProvider {
  readonly name: 'mvola' | 'orange_money' | 'airtel_money';

  initiate(context: PaymentContext): Promise<InitiateResult>;

  /**
   * Vérification active de l'état d'une transaction.
   *
   * Indispensable : les rappels (« webhooks ») de ces fournisseurs sont connus
   * pour être peu fiables. Un job les interroge toutes les 2 minutes pendant
   * 30 minutes, en filet de sécurité du rappel (§14.3, étape 6).
   */
  verify(txId: string): Promise<PaymentStatus>;

  refund(txId: string, amount: string): Promise<RefundResult>;

  /**
   * Vérifie la signature d'un rappel entrant.
   *
   * Un rappel non signé n'est qu'une requête HTTP anonyme prétendant qu'une
   * commande est payée. Un rappel dont la signature échoue est rejeté et
   * journalisé comme incident de sécurité.
   */
  verifyWebhookSignature(rawBody: Buffer, headers: Record<string, string>): boolean;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
