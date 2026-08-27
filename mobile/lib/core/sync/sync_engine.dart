import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/storage/app_database.dart';
import 'package:allgo/core/sync/pending_action.dart';
// `firstOrNull` sur un Iterable vient de `package:collection`, pas de `dart:core`.
import 'package:collection/collection.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:drift/drift.dart';

/// Moteur de synchronisation de la file d'actions différées — §9.3.
///
/// Il ne se déclenche jamais « au cas où » : uniquement au retour du réseau,
/// et à la mise en file d'une action alors que la connexion est disponible.
/// Sur un forfait de données malgache, une synchronisation spéculative coûte
/// réellement de l'argent à l'utilisateur.
class SyncEngine {
  SyncEngine(this._db, this._dio);

  final AppDatabase _db;
  final Dio _dio;

  StreamSubscription<List<ConnectivityResult>>? _subscription;
  bool _draining = false;

  void start() {
    _subscription = Connectivity().onConnectivityChanged.listen((results) {
      final online = results.any((r) => r != ConnectivityResult.none);
      if (online) unawaited(drain());
    });
  }

  Future<void> dispose() async {
    await _subscription?.cancel();
  }

  /// Met une mutation en file, avec sa clé d'idempotence définitive.
  Future<void> enqueue(PendingActionType type, Map<String, dynamic> payload) async {
    if (!type.offlineAllowed) {
      throw StateError(
        'L’action ${type.name} ne peut pas être différée : elle exige une '
        'confirmation serveur immédiate (§9.3).',
      );
    }

    // Le refus est prononcé ICI, pas à l'envoi. Mettre en file une action dont
    // la route n'existe pas encore la ferait échouer silencieusement plus tard,
    // après avoir laissé croire à l'utilisateur qu'elle partirait.
    if (_routeFor(type.name) == null) {
      throw StateError(
        'L’action ${type.name} n’a pas encore de point d’entrée d’API. '
        'Voir la table des lots dans _routeFor.',
      );
    }

    final id = '${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';

    await _db.into(_db.pendingActions).insert(
          PendingActionsCompanion.insert(
            id: id,
            type: type.name,
            payload: jsonEncode(payload),
            idempotencyKey: id,
            createdAt: DateTime.now(),
          ),
        );

    unawaited(drain());
  }

  /// Vide la file, action par action, dans l'ordre de création.
  ///
  /// L'ordre compte : ajouter au panier puis commander ne produit pas le même
  /// résultat dans l'ordre inverse.
  Future<void> drain() async {
    if (_draining) return;
    _draining = true;

    try {
      final now = DateTime.now();
      final due = await (_db.select(_db.pendingActions)
            ..where(
              (t) =>
                  t.status.isIn(<String>['pending', 'failed']) &
                  (t.nextAttemptAt.isNull() | t.nextAttemptAt.isSmallerOrEqualValue(now)),
            )
            ..orderBy([(t) => OrderingTerm.asc(t.createdAt)]))
          .get();

      for (final action in due) {
        await _send(action);
      }
    } finally {
      _draining = false;
    }
  }

  Future<void> _send(PendingActionRow row) async {
    // Abandon après 24 h — l'utilisateur en est notifié (§9.3).
    if (DateTime.now().difference(row.createdAt) > const Duration(hours: 24)) {
      await _finish(row, status: 'failed', error: 'Expirée après 24 heures.');
      return;
    }

    final route = _routeFor(row.type);
    if (route == null) {
      await _finish(row, status: 'failed', error: 'Type d’action inconnu : ${row.type}');
      return;
    }

    try {
      final payload = jsonDecode(row.payload) as Map<String, dynamic>;
      final path = route.path.replaceFirst(':id', payload['lineId']?.toString() ?? '');
      final requestData = Map<String, dynamic>.from(payload)..remove('lineId');
      await _dio.request<dynamic>(
        path,
        data: requestData,
        options: Options(
          method: route.method,
          // La clé stable est ce qui rend la reprise sûre : le serveur
          // reconnaît une commande déjà enregistrée et renvoie sa réponse
          // d'origine au lieu d'en créer une seconde.
          headers: <String, String>{'Idempotency-Key': row.idempotencyKey},
        ),
      );
      await _finish(row, status: 'done');
    } on DioException catch (error) {
      final failure = error.error;

      // Un refus argumenté du serveur (stock insuffisant, produit retiré) est
      // définitif : le rejouer ne changera rien et gaspille des données.
      final isPermanent = failure is ApiFailure && failure.statusCode < 500;

      if (isPermanent) {
        await _finish(row, status: 'failed', error: failure.message);
        return;
      }

      final attempts = row.retryCount + 1;
      final backoff = Duration(
        milliseconds: min(1000 * pow(2, attempts).toInt(), 5 * 60 * 1000),
      );

      await (_db.update(_db.pendingActions)..where((t) => t.id.equals(row.id))).write(
        PendingActionsCompanion(
          status: const Value('failed'),
          retryCount: Value(attempts),
          lastError: Value(failure is Failure ? failure.displayMessage : error.message),
          nextAttemptAt: Value(DateTime.now().add(backoff)),
        ),
      );
    }
  }

  Future<void> _finish(PendingActionRow row, {required String status, String? error}) async {
    await (_db.update(_db.pendingActions)..where((t) => t.id.equals(row.id))).write(
      PendingActionsCompanion(status: Value(status), lastError: Value(error)),
    );
  }

  /// Correspondance action différée → point d'entrée d'API.
  ///
  /// `null` signifie « pas encore servi par l'API ». Les actions sociales
  /// (réaction, commentaire, abonnement) sont différables selon la politique du
  /// §9.3, mais leurs routes n'arrivent qu'au **lot L3** : les déclarer ici
  /// avant leur existence produirait des actions mises en file puis rejetées en
  /// 404, marquées « échec définitif » et perdues sans que l'utilisateur
  /// comprenne pourquoi.
  ({String method, String path})? _routeFor(String type) {
    return switch (PendingActionType.values.where((t) => t.name == type).firstOrNull) {
      // --- Servi depuis le lot L0 ---
      PendingActionType.addToCart => (method: 'POST', path: '/cart/items'),
      PendingActionType.updateCartItem => (method: 'PATCH', path: '/cart/items/:id'),
      PendingActionType.removeCartItem => (method: 'DELETE', path: '/cart/items/:id'),
      PendingActionType.createOrder => (method: 'POST', path: '/orders'),
      PendingActionType.updateProfile => (method: 'PATCH', path: '/me'),

      // --- Lot L3 (social) : à décommenter avec les contrôleurs correspondants
      // PendingActionType.toggleReaction => (method: 'POST', path: '/posts/…/reactions'),
      // PendingActionType.createComment => (method: 'POST', path: '/posts/…/comments'),
      // PendingActionType.toggleFollow  => (method: 'POST', path: '/follows'),
      _ => null,
    };
  }
}
