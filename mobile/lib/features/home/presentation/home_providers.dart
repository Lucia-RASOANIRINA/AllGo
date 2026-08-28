import 'package:allgo/core/storage/app_database.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

export 'package:allgo/features/shops/presentation/shops_providers.dart' show popularShopsProvider;

/// Nouveaux produits — rail « Nouveaux produits » de l'accueil.
///
/// `ProductSort.newest` est déjà le tri par défaut de `fetchRail`.
final AutoDisposeFutureProvider<List<Product>> newProductsProvider =
    FutureProvider.autoDispose<List<Product>>((ref) {
  return ref.watch(productRepositoryProvider).fetchRail();
});

/// Produits les plus consultés — rail « Produits populaires ».
final AutoDisposeFutureProvider<List<Product>> popularProductsProvider =
    FutureProvider.autoDispose<List<Product>>((ref) {
  return ref.watch(productRepositoryProvider).fetchRail(sort: ProductSort.popular);
});

/// Produits en promotion — rail « Promotions ».
final AutoDisposeFutureProvider<List<Product>> promoProductsProvider =
    FutureProvider.autoDispose<List<Product>>((ref) {
  return ref.watch(productRepositoryProvider).fetchRail(onSale: true, sort: ProductSort.popular);
});

/// Promotions à durée limitée — rail « Promotions flash ».
final AutoDisposeFutureProvider<List<Product>> flashPromoProductsProvider =
    FutureProvider.autoDispose<List<Product>>((ref) {
  return ref.watch(productRepositoryProvider).fetchRail(flashOnly: true);
});

/// Produits consultés récemment (local, non synchronisé) — rail d'accueil.
final AutoDisposeFutureProvider<List<RecentlyViewedProduct>> recentProductsLocalProvider =
    FutureProvider.autoDispose<List<RecentlyViewedProduct>>((ref) {
  return ref.watch(appDatabaseProvider).recentProducts();
});

/// Boutiques consultées récemment (local, non synchronisé) — rail d'accueil.
final AutoDisposeFutureProvider<List<RecentlyViewedShop>> recentShopsLocalProvider =
    FutureProvider.autoDispose<List<RecentlyViewedShop>>((ref) {
  return ref.watch(appDatabaseProvider).recentShops();
});

/// Produits recommandés — rail « Recommandé pour vous ».
///
/// Sans moteur de recommandation (hors périmètre du lot L0), la catégorie
/// dominante des produits récemment consultés sert de signal : c'est ce
/// dont on dispose déjà, sans nouvel appel réseau ni modèle. Liste vide tant
/// qu'aucun historique n'existe (démarrage à froid) — pas de repli générique
/// qui donnerait l'illusion d'une recommandation.
final AutoDisposeFutureProvider<List<Product>> recommendedProductsProvider =
    FutureProvider.autoDispose<List<Product>>((ref) async {
  final recent = await ref.watch(recentProductsLocalProvider.future);

  final counts = <String, int>{};
  for (final product in recent) {
    final categoryId = product.categoryId;
    if (categoryId == null) continue;
    counts[categoryId] = (counts[categoryId] ?? 0) + 1;
  }
  if (counts.isEmpty) return const <Product>[];

  final topCategoryId = counts.entries.reduce((a, b) => a.value >= b.value ? a : b).key;

  return ref.watch(productRepositoryProvider).fetchRail(
        categoryId: topCategoryId,
        sort: ProductSort.popular,
      );
});
