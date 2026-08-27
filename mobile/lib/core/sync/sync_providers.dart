import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/storage/app_database.dart';
import 'package:allgo/core/sync/sync_engine.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:drift/drift.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Moteur de synchronisation, démarré une seule fois pour toute l'application.
///
/// `Provider` sans `autoDispose` : la file d'actions différées doit survivre à
/// la fermeture de n'importe quel écran. Une commande mise en attente ne
/// disparaît pas parce que l'utilisateur est revenu à l'accueil.
final syncEngineProvider = Provider<SyncEngine>((ref) {
  final engine = SyncEngine(
    ref.watch(appDatabaseProvider),
    ref.watch(apiClientProvider),
  )..start();

  ref.onDispose(engine.dispose);
  return engine;
});

/// Actions encore en attente d'envoi — alimente le bandeau de l'interface.
///
/// Flux Drift : la liste se met à jour d'elle-même quand le moteur vide la
/// file, sans qu'aucun écran ait à s'abonner au moteur.
final pendingActionsProvider = StreamProvider<List<PendingActionRow>>((ref) {
  final db = ref.watch(appDatabaseProvider);

  return (db.select(db.pendingActions)
        ..where((t) => t.status.isIn(<String>['pending', 'failed']))
        ..orderBy([(t) => OrderingTerm.asc(t.createdAt)]))
      .watch();
});

/// Nombre d'actions en attente — pastille discrète, pas un écran d'alerte.
final pendingActionCountProvider = Provider<int>((ref) {
  return ref.watch(pendingActionsProvider).valueOrNull?.length ?? 0;
});
