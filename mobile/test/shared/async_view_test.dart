import 'package:allgo/core/error/failure.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Les **cinq états obligatoires** du §11.3, vérifiés un à un.
///
/// C'est le composant qui rend la règle structurelle plutôt que déclarative :
/// si l'état vide ou l'état hors ligne cessait de fonctionner, chaque écran de
/// l'application perdrait silencieusement son comportement dégradé.
void main() {
  Widget host(Widget child) => MaterialApp(home: Scaffold(body: child));

  AsyncView<List<String>> view(
    AsyncValue<List<String>> value, {
    List<String>? cached,
    VoidCallback? onRetry,
  }) {
    return AsyncView<List<String>>(
      value: value,
      isEmpty: (list) => list.isEmpty,
      emptyTitle: 'Aucun produit',
      emptyMessage: 'Revenez bientôt.',
      emptyAction: FilledButton(onPressed: () {}, child: const Text('Explorer')),
      cachedData: cached,
      onRetry: onRetry ?? () {},
      data: (list) => ListView(children: list.map(Text.new).toList()),
    );
  }

  group('Les cinq états', () {
    testWidgets('1. chargement — des squelettes, jamais un cercle plein écran', (tester) async {
      await tester.pumpWidget(host(view(const AsyncValue<List<String>>.loading())));

      // Un cercle de chargement plein écran masque la mise en page et donne
      // l'impression d'une application figée (§11.3).
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byType(ListView), findsOneWidget);
    });

    testWidgets('2. chargé — les données sont rendues', (tester) async {
      await tester.pumpWidget(host(view(const AsyncValue.data(<String>['Riz', 'Huile']))));

      expect(find.text('Riz'), findsOneWidget);
      expect(find.text('Huile'), findsOneWidget);
    });

    testWidgets('3. vide — message explicatif ET action proposée', (tester) async {
      await tester.pumpWidget(host(view(const AsyncValue.data(<String>[]))));

      expect(find.text('Aucun produit'), findsOneWidget);
      expect(find.text('Revenez bientôt.'), findsOneWidget);
      // Un état vide sans issue est un défaut de conception, pas un état légitime.
      expect(find.text('Explorer'), findsOneWidget);
    });

    testWidgets('4. erreur — message du serveur et bouton « Réessayer »', (tester) async {
      var retried = 0;

      await tester.pumpWidget(
        host(
          view(
            const AsyncValue<List<String>>.error(
              Failure.api(
                code: 'INSUFFICIENT_STOCK',
                message: 'Stock insuffisant pour « Riz 5 kg ».',
                statusCode: 409,
                requestId: '01J8X',
              ),
              StackTrace.empty,
            ),
            onRetry: () => retried++,
          ),
        ),
      );

      // Le message vient du serveur, déjà localisé (§7.2).
      expect(find.text('Stock insuffisant pour « Riz 5 kg ».'), findsOneWidget);
      // Le `requestId` rend l'incident diagnosticable en une recherche.
      expect(find.textContaining('01J8X'), findsOneWidget);

      await tester.tap(find.text('Réessayer'));
      expect(retried, 1);
    });

    testWidgets('5. hors ligne AVEC cache — bandeau et données affichées', (tester) async {
      await tester.pumpWidget(
        host(
          view(
            const AsyncValue<List<String>>.error(Failure.network(), StackTrace.empty),
            cached: const <String>['Riz en cache'],
          ),
        ),
      );

      // Montrer des données d'il y a dix minutes vaut infiniment mieux qu'un
      // écran d'erreur sur une connexion intermittente.
      expect(find.byType(OfflineBanner), findsOneWidget);
      expect(find.text('Riz en cache'), findsOneWidget);
      expect(find.text('Réessayer'), findsNothing);
    });

    testWidgets('hors ligne SANS cache — état d’erreur classique', (tester) async {
      await tester.pumpWidget(
        host(view(const AsyncValue<List<String>>.error(Failure.network(), StackTrace.empty))),
      );

      expect(find.byType(OfflineBanner), findsNothing);
      expect(find.text('Réessayer'), findsOneWidget);
      expect(
        find.text('Pas de connexion. Les données affichées peuvent ne pas être à jour.'),
        findsOneWidget,
      );
    });
  });

  group('Messages d’échec', () {
    test('un échec métier expose le message du serveur, tel quel', () {
      const failure = Failure.api(
        code: 'INSUFFICIENT_STOCK',
        message: 'Stock insuffisant pour « Riz 5 kg ».',
        statusCode: 409,
      );
      expect(failure.displayMessage, 'Stock insuffisant pour « Riz 5 kg ».');
      expect(failure.isOffline, isFalse);
    });

    test('seul l’échec réseau est reconnu comme hors ligne', () {
      expect(const Failure.network().isOffline, isTrue);
      expect(const Failure.unexpected().isOffline, isFalse);
      expect(const Failure.unauthenticated().isOffline, isFalse);
    });

    test('une annulation ne produit aucun message — l’écran a été quitté', () {
      expect(const Failure.cancelled().displayMessage, isEmpty);
    });
  });
}
