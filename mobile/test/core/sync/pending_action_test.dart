import 'package:allgo/core/sync/pending_action.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Politique hors ligne des actions différées (§9.3)', () {
    test('les actions sans effet de bord serveur sont différables', () {
      expect(PendingActionType.addToCart.offlineAllowed, isTrue);
      expect(PendingActionType.toggleReaction.offlineAllowed, isTrue);
      expect(PendingActionType.updateProfile.offlineAllowed, isTrue);
    });

    test('l’encaissement n’est jamais différable — il exige la confirmation du fournisseur', () {
      expect(PendingActionType.collectPayment.offlineAllowed, isFalse);
    });

    test('un mouvement de stock n’est jamais différable — source de vérité partagée', () {
      expect(PendingActionType.stockMovement.offlineAllowed, isFalse);
    });

    test('une commande est différable, mais avec avertissement explicite', () {
      expect(PendingActionType.createOrder.offlineAllowed, isTrue);
      expect(PendingActionType.createOrder.requiresUserWarning, isTrue);
    });

    test('aucune autre action n’exige d’avertissement', () {
      final warned = PendingActionType.values.where((t) => t.requiresUserWarning);
      expect(warned, <PendingActionType>[PendingActionType.createOrder]);
    });
  });

  group('PendingAction.isExpired', () {
    PendingAction actionCreatedAt(DateTime createdAt) => PendingAction(
          id: 'a',
          type: PendingActionType.addToCart,
          payload: const <String, dynamic>{},
          idempotencyKey: 'a',
          createdAt: createdAt,
        );

    test('abandonne après 24 heures', () {
      final old = DateTime.now().subtract(const Duration(hours: 25));
      expect(actionCreatedAt(old).isExpired, isTrue);
    });

    test('conserve une action de moins de 24 heures', () {
      final recent = DateTime.now().subtract(const Duration(hours: 23));
      expect(actionCreatedAt(recent).isExpired, isFalse);
    });
  });
}
