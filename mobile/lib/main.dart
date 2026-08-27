import 'package:allgo/app/allgo_app.dart';
import 'package:allgo/core/env/environment.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Portrait par défaut ; le paysage n'est autorisé que sur la galerie, la
  // carte et le scan, écran par écran (§13.2).
  await SentryFlutter.init(
    (options) {
      options
        ..dsn = Environment.sentryDsn
        ..environment = Environment.name
        ..tracesSampleRate = Environment.isProduction ? 0.2 : 1.0
        // Aucune donnée personnelle n'est jointe automatiquement aux rapports.
        ..sendDefaultPii = false;
    },
    appRunner: () => runApp(
      const ProviderScope(child: AllGoApp()),
    ),
  );
}
