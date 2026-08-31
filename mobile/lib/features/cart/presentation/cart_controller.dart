import 'dart:async';

import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/storage/app_database.dart';
import 'package:allgo/core/sync/pending_action.dart';
import 'package:allgo/core/sync/sync_providers.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/cart/domain/cart.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:dio/dio.dart';
import 'package:drift/drift.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Panier — **mise à jour optimiste** (§8.2).
///
/// L'ajout est reflété dans l'interface immédiatement, avant confirmation du
/// serveur. Sur un réseau 3G intermittent, attendre l'aller-retour rendrait
/// chaque ajout perceptiblement lent, et l'utilisateur appuierait deux fois.
///
/// Trois cas, un seul comportement visible :
///   - en ligne, succès  → la ligne se confirme silencieusement ;
///   - en ligne, refus   → la ligne est retirée, le motif serveur est affiché ;
///   - hors ligne        → la ligne part en file, marquée « en attente ».
class CartController extends AsyncNotifier<Cart> {
  @override
  Future<Cart> build() async {
    // Sans session, aucun appel réseau : la barre de navigation observe le
    // compteur du panier en permanence, et interroger `/cart` hors session
    // provoquait un 401 à chaque démarrage — donc une tentative de
    // rafraîchissement de jeton parfaitement inutile.
    if (!ref.watch(sessionControllerProvider).isAuthenticated) return const Cart();
    final database = ref.read(appDatabaseProvider);
    final cached = _fromCache(await database.loadCartItems());

    try {
      final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/cart');
      final cart = _fromJson(response.data!['data'] as Map<String, dynamic>?);
      await _persist(cart, database);
      return cart;
    } on DioException catch (error) {
      // Hors ligne : conserver le panier local, y compris ses lignes en attente.
      if (error.error is NetworkFailure) return cached;
      rethrow;
    }
  }

  Future<void> add(Product product, {int quantity = 1}) async {
    final current = state.valueOrNull ?? const Cart();

    final optimistic = _withLine(
      current,
      CartLine(
        // Identifiant local provisoire : remplacé par celui du serveur à la
        // confirmation. Le préfixe évite toute collision avec un ObjectId.
        id: 'local-${product.id}',
        productId: product.id,
        name: product.name,
        unitPrice: product.effectivePrice,
        quantity: quantity,
        shopId: product.shopId,
        shopName: product.shopName,
        image: product.thumbUrl,
        isPending: true,
      ),
    );

    state = AsyncData(optimistic);
    final database = ref.read(appDatabaseProvider);
    await _persist(optimistic, database);

    try {
      final response = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/cart/items',
        data: <String, dynamic>{'productId': product.id, 'quantity': quantity},
      );
      state = AsyncData(_fromJson(response.data!['data'] as Map<String, dynamic>?));
      await _persist(state.requireValue, database);
    } on DioException catch (error) {
      if (error.error is NetworkFailure) {
        // La ligne reste affichée, marquée « en attente », et l'action part en
        // file. C'est la promesse du mode hors ligne : l'action n'est pas
        // perdue, seulement différée (§9.3).
        await ref.read(syncEngineProvider).enqueue(
          PendingActionType.addToCart,
          <String, dynamic>{'productId': product.id, 'quantity': quantity},
        );
        return;
      }

      // Refus argumenté du serveur (stock insuffisant, produit retiré) : on
      // annule l'ajout optimiste et on remonte le message tel quel.
      state = AsyncData(current);
      await _persist(current, database);
      rethrow;
    }
  }

  Future<void> setQuantity(String lineId, int quantity) async {
    final current = state.valueOrNull ?? const Cart();

    state = AsyncData(
      Cart(
        lines: quantity < 1
            ? current.lines.where((l) => l.id != lineId).toList()
            : current.lines
                .map((l) => l.id == lineId ? l.copyWith(quantity: quantity) : l)
                .toList(),
      ),
    );
    final database = ref.read(appDatabaseProvider);
    await _persist(state.requireValue, database);

    try {
      final api = ref.read(apiClientProvider);
      final response = quantity < 1
          ? await api.delete<Map<String, dynamic>>('/cart/items/$lineId')
          : await api.patch<Map<String, dynamic>>(
              '/cart/items/$lineId',
              data: <String, int>{'quantity': quantity},
            );
      state = AsyncData(_fromJson(response.data!['data'] as Map<String, dynamic>?));
      await _persist(state.requireValue, database);
    } on DioException catch (error) {
      if (error.error is NetworkFailure) {
        if (lineId.startsWith('local-')) {
          await ref.read(syncEngineProvider).enqueue(
            PendingActionType.addToCart,
            <String, dynamic>{
              'productId': current.lines.firstWhere((l) => l.id == lineId).productId,
              'quantity': quantity,
            },
          );
        } else {
          await ref.read(syncEngineProvider).enqueue(
            quantity < 1 ? PendingActionType.removeCartItem : PendingActionType.updateCartItem,
            <String, dynamic>{'lineId': lineId, 'quantity': quantity},
          );
        }
        return;
      }
      state = AsyncData(current);
      await _persist(current, database);
      rethrow;
    }
  }

  Future<void> remove(String lineId) => setQuantity(lineId, 0);

  /// Vide le panier — même mise à jour optimiste que `setQuantity`/`remove`.
  Future<void> clear() async {
    final current = state.valueOrNull ?? const Cart();
    if (current.isEmpty) return;

    state = const AsyncData(Cart());
    final database = ref.read(appDatabaseProvider);
    await _persist(const Cart(), database);

    try {
      await ref.read(apiClientProvider).delete<void>('/cart');
    } on DioException catch (error) {
      if (error.error is NetworkFailure) {
        // Le vidage n'est pas rejouable comme une simple ligne (pas de
        // `productId`/`quantity` à mettre en file) : hors ligne, on renonce
        // et on restaure le panier plutôt que de promettre un vidage qui
        // n'arrivera jamais.
        state = AsyncData(current);
        await _persist(current, database);
        return;
      }
      state = AsyncData(current);
      await _persist(current, database);
      rethrow;
    }
  }

  Cart _withLine(Cart cart, CartLine line) {
    final existing = cart.lines.indexWhere((l) => l.productId == line.productId);
    if (existing < 0) return Cart(lines: <CartLine>[...cart.lines, line]);

    final lines = <CartLine>[...cart.lines];
    lines[existing] = lines[existing].copyWith(
      quantity: lines[existing].quantity + line.quantity,
      isPending: true,
    );
    return Cart(lines: lines);
  }

  Cart _fromJson(Map<String, dynamic>? json) {
    final items = (json?['items'] as List<dynamic>?) ?? const <dynamic>[];

    return Cart(
      lines: items.map((raw) {
        final item = raw as Map<String, dynamic>;
        final snapshot = (item['snapshot'] as Map<String, dynamic>?) ?? const <String, dynamic>{};

        return CartLine(
          id: idFromJson(item),
          productId: item['productId'] as String,
          variantId: item['variantId'] as String?,
          name: snapshot['name'] as String? ?? '',
          image: snapshot['image'] as String?,
          unitPrice: moneyFromJson(snapshot['price']),
          quantity: item['quantity'] as int? ?? 1,
          shopId: snapshot['shopId'] as String? ?? '',
          shopName: snapshot['shopName'] as String? ?? '',
        );
      }).toList(),
    );
  }

  Cart _fromCache(List<CachedCartItem> rows) => Cart(
        lines: rows
            .map((row) => CartLine(
                  id: row.id,
                  productId: row.productId,
                  variantId: row.variantId,
                  name: row.name,
                  unitPrice: row.unitPrice,
                  quantity: row.quantity,
                  shopId: row.shopId,
                  shopName: row.shopName,
                  image: row.image,
                  isPending: row.isPending,
                ),)
            .toList(),
      );

  Future<void> _persist(Cart cart, AppDatabase database) => database.replaceCartItems(
        cart.lines
            .map((line) => CachedCartItemsCompanion.insert(
                  id: line.id,
                  productId: line.productId,
                  variantId: Value(line.variantId),
                  name: line.name,
                  unitPrice: line.unitPrice,
                  quantity: line.quantity,
                  shopId: line.shopId,
                  shopName: line.shopName,
                  image: Value(line.image),
                  isPending: Value(line.isPending),
                ),)
            .toList(),
      );
}

final cartControllerProvider = AsyncNotifierProvider<CartController, Cart>(CartController.new);

/// Nombre d'articles, pour la pastille de la barre de navigation.
final cartCountProvider = Provider<int>((ref) {
  return ref.watch(cartControllerProvider).valueOrNull?.itemCount ?? 0;
});
