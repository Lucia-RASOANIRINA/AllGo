import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Fiches complètes des produits favoris — `/me/favorites`, distinct de
/// `favoritesControllerProvider` (identifiants seuls, pour colorer les cœurs).
/// Alimente l'écran « Mes favoris », que `favoritesControllerProvider` seul ne
/// peut pas construire (il ne transporte aucun nom, prix ni image).
class FavoriteProductsState {
  const FavoriteProductsState({required this.items, required this.hasMore, this.nextCursor});

  static const FavoriteProductsState empty = FavoriteProductsState(items: <Product>[], hasMore: false);

  final List<Product> items;
  final bool hasMore;
  final String? nextCursor;
}

class FavoriteProductsController extends AutoDisposeAsyncNotifier<FavoriteProductsState> {
  @override
  Future<FavoriteProductsState> build() => _fetch();

  Future<void> loadMore() async {
    final current = state.valueOrNull;
    final cursor = current?.nextCursor;
    if (current == null || !current.hasMore || cursor == null) return;

    try {
      final next = await _fetch(cursor: cursor);
      state = AsyncData(
        FavoriteProductsState(
          items: <Product>[...current.items, ...next.items],
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
        ),
      );
    } on DioException {
      // Silencieux : la page déjà chargée reste affichée.
    }
  }

  /// Retrait immédiat de la liste — appelé après un `toggle` réussi sur
  /// `favoritesControllerProvider`, pour que la fiche disparaisse sans
  /// attendre un rechargement complet.
  void removeLocally(String productId) {
    final current = state.valueOrNull;
    if (current == null) return;
    state = AsyncData(
      FavoriteProductsState(
        items: current.items.where((p) => p.id != productId).toList(),
        hasMore: current.hasMore,
        nextCursor: current.nextCursor,
      ),
    );
  }

  Future<FavoriteProductsState> _fetch({String? cursor}) async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/me/favorites',
      queryParameters: <String, dynamic>{'limit': 20, if (cursor != null) 'cursor': cursor},
    );

    final body = response.data!;
    final meta = body['meta'] as Map<String, dynamic>?;

    return FavoriteProductsState(
      items: (body['data'] as List<dynamic>)
          .map((json) => _productFromJson(json as Map<String, dynamic>))
          .toList(),
      hasMore: meta?['hasMore'] as bool? ?? false,
      nextCursor: meta?['nextCursor'] as String?,
    );
  }

  Product _productFromJson(Map<String, dynamic> json) {
    final media = (json['media'] as List<dynamic>?) ?? const <dynamic>[];
    final main = media.isEmpty ? null : media.first as Map<String, dynamic>;
    final shop = (json['shop'] as Map<String, dynamic>?) ?? const <String, dynamic>{};

    return Product(
      id: idFromJson(json),
      shopId: json['shopId'] as String? ?? '',
      shopName: shop['name'] as String? ?? '',
      shopSlug: shop['slug'] as String? ?? '',
      name: json['name'] as String? ?? '',
      price: moneyFromJson(json['price']),
      promoPrice: json['promoPrice'] == null ? null : moneyFromJson(json['promoPrice']),
      stock: json['stock'] as int? ?? 0,
      thumbUrl: main?['thumbUrl'] as String?,
      previewUrl: main?['previewUrl'] as String?,
    );
  }
}

final AutoDisposeAsyncNotifierProvider<FavoriteProductsController, FavoriteProductsState>
    favoriteProductsControllerProvider =
    AsyncNotifierProvider.autoDispose<FavoriteProductsController, FavoriteProductsState>(
  FavoriteProductsController.new,
);
