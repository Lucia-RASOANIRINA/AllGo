import 'package:freezed_annotation/freezed_annotation.dart';

part 'failure.freezed.dart';

/// Échecs applicatifs, en union scellée.
///
/// Une union scellée force l'exhaustivité : ajouter un cas d'échec fait échouer
/// la compilation partout où il n'est pas traité. C'est ce qui garantit que
/// l'état « hors ligne » de chaque écran (§11.3) ne peut pas être oublié.
@freezed
sealed class Failure with _$Failure {
  /// Erreur métier renvoyée par l'API, avec un message prêt à afficher.
  const factory Failure.api({
    required String code,
    required String message,
    required int statusCode,
    Map<String, dynamic>? details,
    String? requestId,
  }) = ApiFailure;

  /// Réseau injoignable. L'interface bascule sur le cache local, sans erreur
  /// bloquante : c'est le cas nominal à Mahajanga, pas une exception.
  const factory Failure.network() = NetworkFailure;

  /// Session expirée ou révoquée — retour à l'écran de connexion.
  const factory Failure.unauthenticated() = UnauthenticatedFailure;

  /// Requête annulée (écran quitté avant la fin de l'appel).
  const factory Failure.cancelled() = CancelledFailure;

  /// Cas non prévu — remonté à Sentry, message générique côté utilisateur.
  const factory Failure.unexpected() = UnexpectedFailure;
}

extension FailureMessage on Failure {
  /// Message affichable. Les messages métier viennent du serveur ; seuls les
  /// échecs techniques sont formulés localement.
  String get displayMessage => switch (this) {
        ApiFailure(:final message) => message,
        NetworkFailure() => 'Pas de connexion. Les données affichées peuvent ne pas être à jour.',
        UnauthenticatedFailure() => 'Votre session a expiré. Reconnectez-vous.',
        CancelledFailure() => '',
        UnexpectedFailure() => 'Une erreur inattendue s’est produite. Réessayez dans un instant.',
      };

  bool get isOffline => this is NetworkFailure;
}
