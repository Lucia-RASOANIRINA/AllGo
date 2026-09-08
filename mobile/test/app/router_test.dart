import 'package:allgo/app/router.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/home/presentation/shell_scaffold.dart';
import 'package:allgo/l10n/generated/app_localizations_fr.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// Collecte récursivement les chemins absolus enregistrés dans un `GoRouter`.
///
/// `go_router` compose les chemins imbriqués : une sous-route `:id` sous
/// `/commandes` donne `/commandes/:id`. Reconstituer cette composition est
/// nécessaire pour comparer avec les constantes de `Routes`.
Set<String> collectPaths(List<RouteBase> routes, [String prefix = '']) {
  final paths = <String>{};

  for (final route in routes) {
    if (route is GoRoute) {
      final absolute = route.path.startsWith('/')
          ? route.path
          : '${prefix.endsWith('/') ? prefix.substring(0, prefix.length - 1) : prefix}'
              '/${route.path}';
      paths
        ..add(absolute)
        ..addAll(collectPaths(route.routes, absolute));
    } else {
      // ShellRoute : n'a pas de chemin propre, ses enfants gardent le préfixe.
      paths.addAll(collectPaths(route.routes, prefix));
    }
  }

  return paths;
}

void main() {
  // Construire le routeur réveille `sessionControllerProvider`, qui lit les
  // jetons dans le Keystore via un canal de plateforme (§12.2). Hors appareil,
  // ce canal n'existe pas : on le simule, plutôt que de remplacer le contrôleur
  // de session par un faux — le test perdrait alors ce qu'il vérifie, à savoir
  // le routeur réel avec ses gardes réelles.
  TestWidgetsFlutterBinding.ensureInitialized();

  const secureStorage = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

  late ProviderContainer container;

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorage, (_) async => null);

    container = ProviderContainer();
    addTearDown(container.dispose);
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(secureStorage, null),
    );
  });

  GoRouter buildRouter() => container.read(routerProvider);

  group('Invariant du routeur', () {
    test('chaque chemin déclaré dans Routes est enregistré', () {
      final registered = collectPaths(buildRouter().configuration.routes);

      // Une destination déclarée mais non enregistrée ne produit pas un écran
      // vide : elle fait planter la navigation au premier appui.
      final missing = Routes.all.where((path) => !registered.contains(path)).toList();

      expect(missing, isEmpty, reason: 'Chemins déclarés mais non enregistrés : $missing');
    });

    test('chaque destination d’onglet pointe vers un chemin enregistré', () {
      final registered = collectPaths(buildRouter().configuration.routes);

      final l10n = AppL10nFr();
      final destinations = <NavDestination>[
        ...ShellDestinations.client(l10n),
        ...ShellDestinations.merchant(l10n),
        ...ShellDestinations.courier(l10n),
      ];

      final broken = destinations
          .where((d) => !registered.contains(d.route))
          .map((d) => '${d.label} → ${d.route}')
          .toList();

      expect(broken, isEmpty, reason: 'Onglets sans écran : $broken');
    });

    test('la barre de navigation ne dépasse jamais 5 onglets', () {
      // Material 3 dégrade au-delà de 5 : les libellés se tronquent et les
      // zones tactiles passent sous 48 dp sur un écran de 320 dp (§11.1).
      final l10n = AppL10nFr();
      for (final profile in ActiveProfile.values) {
        expect(ShellDestinations.forProfile(profile, l10n).length, lessThanOrEqualTo(5));
      }
    });

    test('chaque profil propose l’accès au compte', () {
      final l10n = AppL10nFr();
      for (final profile in ActiveProfile.values) {
        final routes = ShellDestinations.forProfile(profile, l10n).map((d) => d.route);
        expect(routes, contains(Routes.account));
      }
    });
  });

  group('Constructeurs de chemins', () {
    test('productPath correspond au motif déclaré', () {
      expect(Routes.productPath('abc123'), '/produit/abc123');
      expect(Routes.product, '/produit/:id');
    });

    test('orderPath correspond au motif déclaré', () {
      expect(Routes.orderPath('abc123'), '/commandes/abc123');
      expect(Routes.orderDetail, '/commandes/:id');
    });

    test('shopPath correspond au motif déclaré', () {
      expect(Routes.shopPath('epicerie-mahavoky'), '/boutique/epicerie-mahavoky');
      expect(Routes.shop, '/boutique/:slug');
    });
  });
}
