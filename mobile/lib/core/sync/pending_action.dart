/// Types d'actions différables et leur politique hors ligne — §9.3.
///
/// Le tableau du cahier des charges est traduit ici en code exécutable : ce
/// n'est pas une convention à respecter, c'est une règle que le moteur de
/// synchronisation applique.
enum PendingActionType {
  /// Sans effet de bord serveur : différable sans réserve.
  addToCart(offlineAllowed: true),
  updateCartItem(offlineAllowed: true),
  removeCartItem(offlineAllowed: true),

  /// Idempotent et tolérant au retard.
  toggleReaction(offlineAllowed: true),
  createComment(offlineAllowed: true),
  toggleFollow(offlineAllowed: true),

  /// Dernière écriture gagnante, par champ.
  updateProfile(offlineAllowed: true),

  /// Différable **avec réserve explicite** : file d'attente, `Idempotency-Key`,
  /// et stock revérifié à l'envoi. L'utilisateur est averti si le produit n'est
  /// plus disponible.
  createOrder(offlineAllowed: true, requiresUserWarning: true),

  /// Exige la confirmation du fournisseur : jamais hors ligne.
  collectPayment(offlineAllowed: false),

  /// Source de vérité partagée entre plusieurs employés : jamais hors ligne.
  stockMovement(offlineAllowed: false);

  const PendingActionType({
    required this.offlineAllowed,
    this.requiresUserWarning = false,
  });

  final bool offlineAllowed;

  /// L'interface doit prévenir explicitement que l'action est mise en attente
  /// et peut encore échouer.
  final bool requiresUserWarning;
}

enum PendingActionStatus { pending, syncing, failed, done }

/// Une mutation en attente d'envoi.
class PendingAction {
  const PendingAction({
    required this.id,
    required this.type,
    required this.payload,
    required this.idempotencyKey,
    required this.createdAt,
    this.status = PendingActionStatus.pending,
    this.retryCount = 0,
    this.lastError,
    this.nextAttemptAt,
  });

  final String id;
  final PendingActionType type;
  final Map<String, dynamic> payload;

  /// Généré à la mise en file, jamais à l'émission : c'est cette stabilité qui
  /// neutralise les doublons après une reprise.
  final String idempotencyKey;

  final DateTime createdAt;
  final PendingActionStatus status;
  final int retryCount;
  final String? lastError;
  final DateTime? nextAttemptAt;

  /// Abandon après 24 h, avec notification à l'utilisateur (§9.3).
  bool get isExpired => DateTime.now().difference(createdAt) > const Duration(hours: 24);
}
