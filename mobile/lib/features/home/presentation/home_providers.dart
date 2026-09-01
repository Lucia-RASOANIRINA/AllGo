import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/storage/recently_viewed_store.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:allgo/features/catalog/presentation/catalog_providers.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

export 'package:allgo/features/shops/presentation/shops_providers.dart' show popularShopsProvider;

/// Boutiques à proximité — rail « Boutiques proches » de l'accueil. Requête
/// indépendante de `nearbyQueryProvider` (piloté par le curseur de rayon de
/// la carte) : l'accueil n'a pas de rayon réglable, un rayon fixe de 5 km suffit.
final AutoDisposeFutureProvider<List<NearbyShop>> nearbyShopsHomeProvider =
    FutureProvider.autoDispose<List<NearbyShop>>((ref) async {
  final position = await ref.watch(currentPositionProvider.future);
  return ref.watch(geoRepositoryProvider).nearbyShops(
        NearbyQuery(latitude: position.latitude, longitude: position.longitude, radiusKm: 5),
      );
});

/// Produits à proximité — rail « Produits proches » de l'accueil.
final AutoDisposeFutureProvider<List<Product>> nearbyProductsProvider =
    FutureProvider.autoDispose<List<Product>>((ref) async {
  final position = await ref.watch(currentPositionProvider.future);
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>(
    '/geo/products',
    queryParameters: <String, dynamic>{
      'lat': position.latitude,
      'lng': position.longitude,
      'radius': 5,
      'limit': 10,
    },
  );
  final items = (response.data?['data'] as List<dynamic>?) ?? const <dynamic>[];
  return items.map((json) => _productFromGeoJson(json as Map<String, dynamic>)).toList();
});

Product _productFromGeoJson(Map<String, dynamic> json) {
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

/// Promotion flash — élément affiché par le rail « Promotions flash ».
class FlashPromo {
  const FlashPromo({required this.promotionId, required this.endsAt, required this.product});

  factory FlashPromo.fromJson(Map<String, dynamic> json) {
    final product = (json['product'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final media = (product['media'] as List<dynamic>?) ?? const <dynamic>[];
    final main = media.isEmpty ? null : media.first as Map<String, dynamic>;
    final shop = (product['shop'] as Map<String, dynamic>?) ?? const <String, dynamic>{};

    return FlashPromo(
      promotionId: json['promotionId'] as String? ?? '',
      endsAt: DateTime.tryParse(json['endsAt'] as String? ?? '') ?? DateTime.now(),
      product: Product(
        id: idFromJson(product),
        shopId: product['shopId']?.toString() ?? '',
        shopName: shop['name'] as String? ?? '',
        shopSlug: shop['slug'] as String? ?? '',
        name: product['name'] as String? ?? '',
        price: moneyFromJson(product['price']),
        promoPrice: product['promoPrice'] == null ? null : moneyFromJson(product['promoPrice']),
        stock: product['stock'] as int? ?? 0,
        thumbUrl: main?['thumbUrl'] as String?,
        previewUrl: main?['previewUrl'] as String?,
      ),
    );
  }

  final String promotionId;
  final DateTime endsAt;
  final Product product;
}

/// Promotions à durée limitée — rail « Promotions flash ». Distinct de
/// `fetchRail` : une promotion flash est une entité à part (`Promotion`),
/// pas un simple filtre de produit — voir `campaigns.service.ts#activeFlash`.
final AutoDisposeFutureProvider<List<FlashPromo>> flashPromoProductsProvider =
    FutureProvider.autoDispose<List<FlashPromo>>((ref) async {
  final response =
      await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/campaigns/flash');
  final items = (response.data?['data'] as List<dynamic>?) ?? const <dynamic>[];
  return items.map((json) => FlashPromo.fromJson(json as Map<String, dynamic>)).toList();
});

/// Produits consultés récemment (local, non synchronisé) — rail d'accueil.
final Provider<List<RecentlyViewedProduct>> recentProductsLocalProvider =
    Provider<List<RecentlyViewedProduct>>((ref) {
  return ref.watch(recentlyViewedStoreProvider).recentProducts();
});

/// Boutiques consultées récemment (local, non synchronisé) — rail d'accueil.
final Provider<List<RecentlyViewedShop>> recentShopsLocalProvider =
    Provider<List<RecentlyViewedShop>>((ref) {
  return ref.watch(recentlyViewedStoreProvider).recentShops();
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
  final recent = ref.watch(recentProductsLocalProvider);

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
