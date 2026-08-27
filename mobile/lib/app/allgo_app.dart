import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/sync/sync_providers.dart';
import 'package:allgo/features/settings/presentation/settings_controller.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AllGoApp extends ConsumerWidget {
  const AllGoApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final settings = ref.watch(settingsControllerProvider);

    // Démarre le moteur de synchronisation au lancement, et non à la première
    // erreur réseau. Sans cette lecture, `SyncEngine.start()` n'était jamais
    // appelé : l'écoute de la connectivité n'existait pas, et une action mise
    // en file lors d'une session précédente n'était jamais renvoyée au retour
    // du réseau — la promesse du §9.3 ne tenait pas.
    ref.watch(syncEngineProvider);

    return MaterialApp.router(
      title: 'AllGo',
      debugShowCheckedModeBanner: false,
      routerConfig: router,

      // Clair, sombre et système — parité avec le web, qui propose déjà la
      // bascule (§11.1).
      theme: AllGoTheme.light,
      darkTheme: AllGoTheme.dark,
      themeMode: settings.themeMode,

      // Français par défaut, malgache en seconde langue : l'application vise
      // Mahajanga, où le malgache est la langue d'usage (§11.5).
      locale: settings.locale,
      localizationsDelegates: AppL10n.localizationsDelegates,
      supportedLocales: AppL10n.supportedLocales,

      builder: (context, child) {
        // Respect de la taille de police système jusqu'à 200 % (§11.4), sans
        // laisser une valeur extrême casser toutes les mises en page.
        final scale = MediaQuery.textScalerOf(context).clamp(
          minScaleFactor: 0.85,
          maxScaleFactor: 2,
        );
        return MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: scale),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}
