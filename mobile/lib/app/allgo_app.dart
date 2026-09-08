import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/sync/sync_providers.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/settings/presentation/settings_controller.dart';
import 'package:allgo/l10n/generated/app_localizations.dart';
import 'package:allgo/shared/widgets/splash_screen.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// `flutter_localizations` ne fournit pas de traductions Material/Widgets
/// pour le malgache (`mg`) : sans repli, `MaterialLocalizations.of(context)`
/// renvoie `null` dès que la langue de l'application passe en malgache, et
/// tout widget interne qui en dépend (barre d'onglets, bouton retour,
/// info-bulles...) lève « No MaterialLocalizations found » au premier
/// affichage — l'écran reste à moitié construit (texte replié, zones grises),
/// sans qu'aucun code applicatif ne soit en cause. Ces délégués déclarent le
/// malgache « supporté » mais chargent silencieusement les données
/// françaises, qui restent la langue de repli documentée par ailleurs.
class _FallbackMaterialLocalizationsDelegate extends LocalizationsDelegate<MaterialLocalizations> {
  const _FallbackMaterialLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => locale.languageCode == 'mg';

  @override
  Future<MaterialLocalizations> load(Locale locale) =>
      GlobalMaterialLocalizations.delegate.load(const Locale('fr'));

  @override
  bool shouldReload(_FallbackMaterialLocalizationsDelegate old) => false;
}

class _FallbackWidgetsLocalizationsDelegate extends LocalizationsDelegate<WidgetsLocalizations> {
  const _FallbackWidgetsLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => locale.languageCode == 'mg';

  @override
  Future<WidgetsLocalizations> load(Locale locale) =>
      GlobalWidgetsLocalizations.delegate.load(const Locale('fr'));

  @override
  bool shouldReload(_FallbackWidgetsLocalizationsDelegate old) => false;
}

class _FallbackCupertinoLocalizationsDelegate
    extends LocalizationsDelegate<CupertinoLocalizations> {
  const _FallbackCupertinoLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => locale.languageCode == 'mg';

  @override
  Future<CupertinoLocalizations> load(Locale locale) =>
      GlobalCupertinoLocalizations.delegate.load(const Locale('fr'));

  @override
  bool shouldReload(_FallbackCupertinoLocalizationsDelegate old) => false;
}

class AllGoApp extends ConsumerWidget {
  const AllGoApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final settings = ref.watch(settingsControllerProvider);
    final isRestoring = ref.watch(sessionControllerProvider.select((s) => s.isRestoring));

    // Démarre le moteur de synchronisation au lancement, et non à la première
    // erreur réseau. Sans cette lecture, `SyncEngine.start()` n'était jamais
    // appelé : l'écoute de la connectivité n'existait pas, et une action mise
    // en file lors d'une session précédente n'était jamais renvoyée au retour
    // du réseau — la promesse du §9.3 ne tenait pas.
    ref.watch(syncEngineProvider);

    return MaterialApp.router(
      // Changer la langue en direct reconfigure `Localizations` pour tout
      // l'arbre : sans ce remontage forcé, certains écrans déjà construits
      // gardent des contraintes de mise en page calculées sous l'ancienne
      // langue et s'affichent corrompus (texte replié lettre par lettre,
      // zones grises) tant que l'application n'est pas relancée. La clé
      // force Flutter à reconstruire l'arbre à neuf au lieu de réutiliser
      // des éléments devenus incohérents.
      key: ValueKey(settings.locale),
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
      localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
        _FallbackMaterialLocalizationsDelegate(),
        _FallbackWidgetsLocalizationsDelegate(),
        _FallbackCupertinoLocalizationsDelegate(),
        ...AppL10n.localizationsDelegates,
      ],
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
          // Recouvre l'écran, quelle que soit la route déjà résolue par
          // GoRouter en dessous : sans ça, l'accueil (ou toute autre route
          // initiale) apparaît un instant dans un état encore incertain,
          // avant même que le jeton stocké n'ait été vérifié.
          child: isRestoring ? const SplashScreen() : (child ?? const SizedBox.shrink()),
        );
      },
    );
  }
}
