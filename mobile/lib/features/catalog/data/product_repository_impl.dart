import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/core/storage/app_database.dart';
import 'package:collection/collection.dart';
import 'package:allgo/features/catalog/domain/entities/product.dart';
import 'package:allgo/features/catalog/domain/repositories/product_repository.dart';
import 'package:dio/dio.dart';
import 'package:drift/drift.dart';

/// Implémentation hors ligne d'abord du dépôt de produits.
///
///     Widget → Riverpod → Repository ──► Drift (local)   ──► affichage IMMÉDIAT
///                               │
///                               └──────► API (arrière-plan) ──► mise à jour du cache
///                                                            ──► rafraîchissement réactif
///
/// L'interface lit toujours la base locale ; le réseau ne fait qu'alimenter
/// cette base. Aucun écran n'affiche d'indicateur de chargement bloquant si une
/// donnée en cache existe (§9.1).
class ProductRepositoryImpl implements ProductRepository {
  ProductRepositoryImpl(this._dio, this._db);

  final Dio _dio;
  final AppDatabase _db;

  /// Fraîcheur du catalogue consulté : 1 h (§9.2).
  static const Duration _catalogFreshness = Duration(hours: 1);

  @override
  Stream<ProductPage> watchProducts(ProductFilter filter, {String? cursor}) async* {
    // 1. Le cache d'abord — l'utilisateur voit quelque chose immédiatement.
    //    Uniquement sur la première page : un curseur cible une position
    //    serveur qui n'a pas d'équivalent local.
    if (cursor == null) {
      final cached = await _db.searchProducts(
        query: filter.query,
        categoryId: filter.categoryId,
        minPrice: filter.minPrice,
        maxPrice: filter.maxPrice,
        inStockOnly: filter.inStockOnly,
      );

      if (cached.isNotEmpty) {
        yield ProductPage(
          products: cached.map(_fromCache).toList(),
          hasMore: false,
          isFromCache: true,
        );
      }
    }

    // 2. Le réseau ensuite — met à jour le cache, puis l'affichage.
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/products',
        queryParameters: <String, dynamic>{
          'limit': 20,
          if (cursor != null) 'cursor': cursor,
          if (filter.query != null) 'q': filter.query,
          if (filter.categoryId != null) 'category': filter.categoryId,
          if (filter.shopId != null) 'shop': filter.shopId,
          if (filter.minPrice != null) 'minPrice': filter.minPrice,
          if (filter.maxPrice != null) 'maxPrice': filter.maxPrice,
          if (filter.inStockOnly) 'inStock': true,
          // Projection partielle : une grille n'a pas besoin des descriptions.
          'fields': 'id,name,price,promoPrice,media,stock,shop,shopId,categoryId',
        },
      );

      final body = response.data!;
      final products = (body['data'] as List<dynamic>)
          .map((json) => _fromJson(json as Map<String, dynamic>))
          .toList();

      await _cache(products);

      yield ProductPage(
        products: products,
        hasMore: (body['meta'] as Map<String, dynamic>?)?['hasMore'] as bool? ?? false,
        nextCursor: (body['meta'] as Map<String, dynamic>?)?['nextCursor'] as String?,
      );
    } on DioException catch (error) {
      // Hors ligne avec du cache déjà émis : ce n'est pas une erreur, c'est le
      // fonctionnement attendu. On ne relance que si rien n'a pu être montré.
      final failure = error.error;
      if (failure is NetworkFailure && cursor == null) return;
      rethrow;
    }
  }

  @override
  Future<Product> getProduct(String id) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>('/products/$id');
      final product = _fromJson(response.data!['data'] as Map<String, dynamic>);
      await _cache(<Product>[product]);
      return product;
    } on DioException catch (error) {
      if (error.error is! NetworkFailure) rethrow;

      // Repli sur la fiche en cache — rétention 30 jours (§9.2).
      final cached =
          await (_db.select(_db.cachedProducts)..where((t) => t.id.equals(id))).getSingleOrNull();
      if (cached == null) rethrow;
      return _fromCache(cached);
    }
  }

  @override
  Future<List<Product>> fetchRail({
    ProductSort sort = ProductSort.newest,
    bool onSale = false,
    String? categoryId,
    int limit = 10,
  }) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(
        '/products',
        queryParameters: <String, dynamic>{
          'limit': limit,
          'sort': sort == ProductSort.popular ? 'popular' : 'newest',
          if (onSale) 'onSale': true,
          if (categoryId != null) 'category': categoryId,
          'fields': 'id,name,price,promoPrice,media,stock,shop,shopId,categoryId',
        },
      );
      return (response.data!['data'] as List<dynamic>)
          .map((json) => _fromJson(json as Map<String, dynamic>))
          .toList();
    } on DioException catch (error) {
      // Un rail de vitrine hors ligne reste vide plutôt que de faire échouer
      // tout l'accueil : le catalogue complet, lui, reste servi par le cache.
      // `RetryInterceptor` a déjà retenté la requête (§9.3) — si elle échoue
      // encore ici, c'est une coupure réelle, pas un raté isolé.
      if (error.error is NetworkFailure) return const <Product>[];
      rethrow;
    }
  }

  @override
  Future<Product> getByBarcode(String barcode, {String? shopId}) async {
    // Le scan sert d'abord au magasinier, souvent en réserve où le réseau est
    // mauvais : le cache local est interrogé en premier.
    final cached = await (_db.select(_db.cachedProducts)..where((t) => t.barcode.equals(barcode)))
        .getSingleOrNull();
    if (cached != null) return _fromCache(cached);

    final response = await _dio.get<Map<String, dynamic>>(
      '/products/barcode/$barcode',
      queryParameters: <String, dynamic>{if (shopId != null) 'shop': shopId},
    );
    return _fromJson(response.data!['data'] as Map<String, dynamic>);
  }

  Future<void> _cache(List<Product> products) async {
    final now = DateTime.now();
    await _db.batch((batch) {
      batch.insertAllOnConflictUpdate(
        _db.cachedProducts,
        products.map(
          (p) => CachedProductsCompanion.insert(
            id: p.id,
            shopId: p.shopId,
            shopName: p.shopName,
            shopSlug: Value(p.shopSlug),
            name: p.name,
            description: Value(p.description),
            categoryId: Value(p.categoryId),
            price: p.price,
            promoPrice: Value(p.promoPrice),
            stock: Value(p.stock),
            thumbUrl: Value(p.thumbUrl),
            barcode: Value(p.barcode),
            latitude: Value(p.latitude),
            longitude: Value(p.longitude),
            cachedAt: now,
            updatedAt: now,
          ),
        ),
      );
    });
  }

  Product _fromJson(Map<String, dynamic> json) {
    final media = (json['media'] as List<dynamic>?) ?? const <dynamic>[];
    final shop = (json['shop'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final productName = (json['name'] as String?) ?? 'Produit';
    final fallbackGallery = _fallbackGalleryFor(productName);
    final safeMedia = media.whereType<Map<String, dynamic>>().toList();
    final main = safeMedia.isEmpty ? null : safeMedia.first;
    final gallery = safeMedia.isNotEmpty
        ? safeMedia
            .map((m) => (m['previewUrl'] as String?) ?? (m['thumbUrl'] as String?))
            .whereType<String>()
            .toList()
        : fallbackGallery;

    return Product(
      id: idFromJson(json),
      shopId: json['shopId'] as String? ?? '',
      shopName: shop['name'] as String? ?? '',
      shopSlug: shop['slug'] as String? ?? '',
      name: productName,
      description: json['description'] as String?,
      categoryId: json['categoryId'] as String?,
      // Montants lus par `moneyFromJson` : jamais par un `double`.
      price: moneyFromJson(json['price']),
      promoPrice: json['promoPrice'] == null ? null : moneyFromJson(json['promoPrice']),
      stock: json['stock'] as int? ?? 0,
      thumbUrl: (main?['thumbUrl'] as String?) ?? gallery.firstOrNull,
      previewUrl: (main?['previewUrl'] as String?) ?? gallery.firstOrNull,
      barcode: json['barcode'] as String?,
      gallery: gallery,
    );
  }

  List<String> _fallbackGalleryFor(String productName) {
    final normalized = productName.toLowerCase();

    if (normalized.contains('riz')) {
      return <String>[
        'https://images.unsplash.com/photo-1586201375761-83865001e31d?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1604908556856-ff686c9fe616?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=1200&q=80',
      ];
    }
    if (normalized.contains('huile')) {
      return <String>[
        'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1577311364431-2358a7f306d9?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80',
      ];
    }
    if (normalized.contains('sucre')) {
      return <String>[
        'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1502741338009-cac2772e18bc?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1518843875459-f738682238a6?auto=format&fit=crop&w=1200&q=80',
      ];
    }

    return <String>[
      'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1528747045269-390fe33c19f2?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=1200&q=80',
    ];
  }

  Product _fromCache(CachedProduct row) => Product(
        id: row.id,
        shopId: row.shopId,
        shopName: row.shopName,
        shopSlug: row.shopSlug,
        name: row.name,
        description: row.description,
        categoryId: row.categoryId,
        price: row.price,
        promoPrice: row.promoPrice,
        stock: row.stock,
        thumbUrl: row.thumbUrl,
        barcode: row.barcode,
        latitude: row.latitude,
        longitude: row.longitude,
        isFromCache: true,
      );

  /// Le cache est-il encore considéré comme frais ?
  static bool isFresh(DateTime cachedAt) => DateTime.now().difference(cachedAt) < _catalogFreshness;
}
