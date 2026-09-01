import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Produit consulté récemment — historique purement local (§ accueil).
class RecentlyViewedProduct {
  const RecentlyViewedProduct({
    required this.id,
    required this.name,
    this.categoryId,
    this.thumbUrl,
    this.price,
  });

  factory RecentlyViewedProduct.fromJson(Map<String, dynamic> json) => RecentlyViewedProduct(
        id: json['id'] as String,
        name: json['name'] as String,
        categoryId: json['categoryId'] as String?,
        thumbUrl: json['thumbUrl'] as String?,
        price: json['price'] as int?,
      );

  final String id;
  final String name;
  final String? categoryId;
  final String? thumbUrl;
  final int? price;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'name': name,
        'categoryId': categoryId,
        'thumbUrl': thumbUrl,
        'price': price,
      };
}

/// Boutique consultée récemment — même principe.
class RecentlyViewedShop {
  const RecentlyViewedShop({required this.id, required this.slug, required this.name, this.logo});

  factory RecentlyViewedShop.fromJson(Map<String, dynamic> json) => RecentlyViewedShop(
        id: json['id'] as String,
        slug: json['slug'] as String,
        name: json['name'] as String,
        logo: json['logo'] as String?,
      );

  final String id;
  final String slug;
  final String name;
  final String? logo;

  Map<String, dynamic> toJson() =>
      <String, dynamic>{'id': id, 'slug': slug, 'name': name, 'logo': logo};
}

/// Historique « récemment consulté », en `SharedPreferences` — non
/// synchronisé, non partagé entre appareils : c'est une simple commodité de
/// navigation, pas une donnée métier, elle ne justifie pas une table Drift ni
/// sa régénération de code (§9.1 porte sur le catalogue, pas cet historique).
class RecentlyViewedStore {
  RecentlyViewedStore(this._prefs);

  final SharedPreferences _prefs;

  static const _productsKey = 'recently_viewed_products';
  static const _shopsKey = 'recently_viewed_shops';
  static const _maxEntries = 20;

  List<RecentlyViewedProduct> recentProducts() => _read(_productsKey)
      .map((raw) => RecentlyViewedProduct.fromJson(raw))
      .toList();

  List<RecentlyViewedShop> recentShops() =>
      _read(_shopsKey).map((raw) => RecentlyViewedShop.fromJson(raw)).toList();

  Future<void> addProduct(RecentlyViewedProduct product) =>
      _push(_productsKey, product.id, product.toJson());

  Future<void> addShop(RecentlyViewedShop shop) => _push(_shopsKey, shop.id, shop.toJson());

  List<Map<String, dynamic>> _read(String key) {
    final raw = _prefs.getString(key);
    if (raw == null) return const <Map<String, dynamic>>[];
    final decoded = jsonDecode(raw);
    if (decoded is! List) return const <Map<String, dynamic>>[];
    return decoded.whereType<Map<String, dynamic>>().toList();
  }

  Future<void> _push(String key, String id, Map<String, dynamic> entry) async {
    final current = _read(key).where((item) => item['id'] != id).toList();
    final updated = <Map<String, dynamic>>[entry, ...current].take(_maxEntries).toList();
    await _prefs.setString(key, jsonEncode(updated));
  }
}

final Provider<SharedPreferences> sharedPreferencesProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError('sharedPreferencesProvider doit être surchargé au démarrage'),
);

final Provider<RecentlyViewedStore> recentlyViewedStoreProvider = Provider<RecentlyViewedStore>(
  (ref) => RecentlyViewedStore(ref.watch(sharedPreferencesProvider)),
);
