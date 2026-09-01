import 'dart:async';

import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/storage/app_database.dart';
import 'package:allgo/features/catalog/data/product_repository_impl.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final appDatabaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(db.close);
  return db;
});

final productRepositoryProvider = Provider<ProductRepository>((ref) {
  return ProductRepositoryImpl(
    ref.watch(apiClientProvider),
    ref.watch(appDatabaseProvider),
  );
});

final StateProvider<ProductFilter> catalogFilterProvider =
    StateProvider<ProductFilter>((_) => const ProductFilter());

/// Catalogue affiché à l'accueil.
///
/// `StreamProvider` et non `FutureProvider` : le dépôt émet d'abord le cache,
/// puis la version réseau (§9.1). L'écran se peint immédiatement avec les
/// données locales, puis se rafraîchit sans indicateur de chargement bloquant.
final AutoDisposeStreamProvider<List<Product>> catalogProvider =
    StreamProvider.autoDispose<List<Product>>((ref) {
  final filter = ref.watch(catalogFilterProvider);

  // Le résultat survit 5 minutes à la fermeture de l'écran : revenir en
  // arrière ne doit pas relancer une requête réseau déjà payée.
  final link = ref.keepAlive();
  final timer = Timer(const Duration(minutes: 5), link.close);
  ref.onDispose(timer.cancel);

  return ref.watch(productRepositoryProvider).watchProducts(filter).map((page) => page.products);
});

/// Référentiel des catégories.
///
/// `keepAlive` par défaut (pas d'`autoDispose`) : il change quelques fois par
/// an et sert plusieurs écrans. Le recharger à chaque ouverture de la feuille
/// de filtres coûterait des données pour rien.
final FutureProvider<List<Category>> categoryTreeProvider = FutureProvider<List<Category>>((
  ref,
) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/categories');

  Category parse(Map<String, dynamic> json) => Category(
        id: idFromJson(json),
        name: json['name'] as String,
        slug: json['slug'] as String? ?? '',
        icon: json['icon'] as String?,
        children: ((json['children'] as List<dynamic>?) ?? const <dynamic>[])
            .map((child) => parse(child as Map<String, dynamic>))
            .toList(),
      );

  return (response.data!['data'] as List<dynamic>)
      .map((json) => parse(json as Map<String, dynamic>))
      .toList();
});

/// Fiche produit — rétention hors ligne de 30 jours (§9.2).
final AutoDisposeFutureProviderFamily<Product, String> productDetailProvider =
    FutureProvider.autoDispose.family<Product, String>((ref, id) {
  return ref.watch(productRepositoryProvider).getProduct(id);
});

/// Produits similaires — `GET /products/:id/similar` (même catégorie, à
/// défaut même boutique). Appel Dio direct, comme `popularShopsProvider` :
/// section secondaire bornée, pas un flux hors ligne d'abord.
final AutoDisposeFutureProviderFamily<List<Product>, String> similarProductsProvider =
    FutureProvider.autoDispose.family<List<Product>, String>((ref, productId) async {
  try {
    final response = await ref
        .watch(apiClientProvider)
        .get<Map<String, dynamic>>('/products/$productId/similar');
    final items = (response.data?['data'] as List<dynamic>?) ?? const <dynamic>[];
    return items.map((json) => _similarProductFromJson(json as Map<String, dynamic>)).toList();
  } on Exception {
    return const <Product>[];
  }
});

Product _similarProductFromJson(Map<String, dynamic> json) {
  final media = (json['media'] as List<dynamic>?) ?? const <dynamic>[];
  final main = media.isEmpty ? null : media.first as Map<String, dynamic>;
  final shop = (json['shop'] as Map<String, dynamic>?) ?? const <String, dynamic>{};

  return Product(
    id: idFromJson(json),
    shopId: json['shopId']?.toString() ?? '',
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
