import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/favorites/presentation/favorites_controller.dart';
import 'package:allgo/features/home/presentation/home_screen.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final AutoDisposeFutureProvider<List<Product>> favoritesListProvider =
    FutureProvider.autoDispose<List<Product>>((ref) async {
  // Le provider dépend du compteur de favoris pour se recalculer précisément au
  // moment où un cœur est ajouté ou retiré depuis une autre vue.
  ref.watch(favoritesControllerProvider);

  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>(
    '/me/favorites?limit=50',
  );

  final items = (response.data!['data'] as List<dynamic>? ?? const <dynamic>[]);
  return items
      .map((json) => _favoriteProductFromJson(json as Map<String, dynamic>))
      .toList();
});

Product _favoriteProductFromJson(Map<String, dynamic> json) {
  final media = (json['media'] as List<dynamic>?) ?? const <dynamic>[];
  final main = media.isEmpty ? null : media.first as Map<String, dynamic>;
  final shop = (json['shop'] as Map<String, dynamic>?) ?? const <String, dynamic>{};

  return Product(
    id: idFromJson(json),
    shopId: json['shopId'] as String? ?? '',
    shopName: shop['name'] as String? ?? '',
    shopSlug: shop['slug'] as String? ?? '',
    name: json['name'] as String,
    description: json['description'] as String?,
    categoryId: json['categoryId'] as String?,
    price: moneyFromJson(json['price']),
    promoPrice: json['promoPrice'] == null ? null : moneyFromJson(json['promoPrice']),
    stock: json['stock'] as int? ?? 0,
    thumbUrl: main?['thumbUrl'] as String?,
    previewUrl: main?['previewUrl'] as String?,
    gallery: media
        .map((m) => (m as Map<String, dynamic>)['previewUrl'] as String?)
        .whereType<String>()
        .toList(),
  );
}

class FavoritesScreen extends ConsumerWidget {
  const FavoritesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final favorites = ref.watch(favoritesListProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Mes favoris')),
      body: AsyncView<List<Product>>(
        value: favorites,
        isEmpty: (items) => items.isEmpty,
        emptyTitle: 'Aucun favori pour le moment',
        emptyMessage: 'Enregistrez vos produits préférés pour les retrouver ici.',
        onRetry: () => ref.invalidate(favoritesListProvider),
        data: (items) => GridView.builder(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 220,
            mainAxisSpacing: AllGoTokens.space3,
            crossAxisSpacing: AllGoTokens.space3,
            childAspectRatio: 0.72,
          ),
          itemCount: items.length,
          itemBuilder: (context, index) => ProductCard(product: items[index]),
        ),
      ),
    );
  }
}
