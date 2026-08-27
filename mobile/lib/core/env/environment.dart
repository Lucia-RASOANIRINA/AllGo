/// Configuration de compilation, injectée par `--dart-define`.
///
/// Aucune valeur sensible n'est codée en dur dans le binaire ni versionnée
/// (§12.1). En développement, l'URL par défaut vise `10.0.2.2`, l'alias de
/// `localhost` vu depuis l'émulateur Android.
abstract final class Environment {
  static const String name = String.fromEnvironment(
    'ENV',
    defaultValue: 'development',
  );

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000/v1',
  );

  static const String socketUrl = String.fromEnvironment(
    'SOCKET_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  static const String sentryDsn = String.fromEnvironment('SENTRY_DSN');

  static bool get isProduction => name == 'production';

  /// Empreintes SHA-256 des certificats de l'API — épinglage (§12.2).
  ///
  /// Deux empreintes : celle en service et celle de secours. Sans certificat de
  /// secours, une rotation de certificat rendrait inutilisables tous les
  /// terminaux non mis à jour.
  static const List<String> certificatePins = <String>[
    String.fromEnvironment('CERT_PIN_PRIMARY'),
    String.fromEnvironment('CERT_PIN_BACKUP'),
  ];
}
