import 'package:allgo/features/catalog/domain/entities/product.dart';

/// Tri du catalogue — reflète `sort=new|popular` côté API.
enum ProductSort { newest, popular }

/// Filtres de catalogue.
class ProductFilter {
  const ProductFilter({
    this.query,
    this.categoryId,
    this.shopId,
    this.minPrice,
    this.maxPrice,
    this.inStockOnly = false,
    this.sort = ProductSort.newest,
    this.onSale = false,
    this.minRating,
  });

  final String? query;
  final String? categoryId;
  final String? shopId;
  final int? minPrice;
  final int? maxPrice;
  final bool inStockOnly;
  final ProductSort sort;
  final bool onSale;
  final double? minRating;

  /// Copie partielle. Les champs omis sont conservés ; pour **retirer** un
  /// filtre, utiliser `clearPrice` ou `clearCategory` — un `copyWith(x: null)`
  /// ne saurait pas distinguer « inchangé » de « effacé ».
  ProductFilter copyWith({
    String? query,
    String? categoryId,
    String? shopId,
    int? minPrice,
    int? maxPrice,
    bool? inStockOnly,
    ProductSort? sort,
    bool? onSale,
    double? minRating,
  }) {
    return ProductFilter(
      query: query ?? this.query,
      categoryId: categoryId ?? this.categoryId,
      shopId: shopId ?? this.shopId,
      minPrice: minPrice ?? this.minPrice,
      maxPrice: maxPrice ?? this.maxPrice,
      inStockOnly: inStockOnly ?? this.inStockOnly,
      sort: sort ?? this.sort,
      onSale: onSale ?? this.onSale,
      minRating: minRating ?? this.minRating,
    );
  }

  ProductFilter clearPrice() => ProductFilter(
        query: query,
        categoryId: categoryId,
        shopId: shopId,
        inStockOnly: inStockOnly,
        sort: sort,
        onSale: onSale,
        minRating: minRating,
      );

  ProductFilter clearCategory() => ProductFilter(
        query: query,
        shopId: shopId,
        minPrice: minPrice,
        maxPrice: maxPrice,
        inStockOnly: inStockOnly,
        sort: sort,
        onSale: onSale,
        minRating: minRating,
      );

  ProductFilter clearQuery() => ProductFilter(
        categoryId: categoryId,
        shopId: shopId,
        minPrice: minPrice,
        maxPrice: maxPrice,
        inStockOnly: inStockOnly,
        sort: sort,
        onSale: onSale,
        minRating: minRating,
      );

  ProductFilter clearRating() => ProductFilter(
        query: query,
        categoryId: categoryId,
        shopId: shopId,
        minPrice: minPrice,
        maxPrice: maxPrice,
        inStockOnly: inStockOnly,
        sort: sort,
        onSale: onSale,
      );
}

/// Catégorie du référentiel, avec ses sous-catégories.
///
/// L'arborescence est renvoyée en une seule réponse et mise en cache 24 h
/// (§9.2) : ce référentiel change quelques fois par an.
class Category {
  const Category({
    required this.id,
    required this.name,
    required this.slug,
    this.icon,
    this.children = const <Category>[],
  });

  final String id;
  final String name;
  final String slug;
  final String? icon;
  final List<Category> children;
}

/// Page de résultats, paginée par curseur (§7.1).
class ProductPage {
  const ProductPage({
    required this.products,
    required this.hasMore,
    this.nextCursor,
    this.isFromCache = false,
  });

  final List<Product> products;
  final bool hasMore;
  final String? nextCursor;
  final bool isFromCache;
}

/// Contrat de dépôt — implémenté dans la couche `data`.
///
/// La règle de dépendance est `presentation → domain → data` (§4.3) : le
/// domaine définit ce dont il a besoin, l'infrastructure s'y conforme.
abstract interface class ProductRepository {
  /// Flux de pages : **émet d'abord le cache**, puis la version réseau.
  ///
  /// C'est la traduction du principe « hors ligne d'abord » (§9.1) en une
  /// signature de méthode. Un `Future` unique obligerait l'interface à choisir
  /// entre afficher vite et afficher juste ; un `Stream` fait les deux.
  Stream<ProductPage> watchProducts(ProductFilter filter, {String? cursor});

  Future<Product> getProduct(String id);

  /// Identification par scan de code-barres (§2.2).
  Future<Product> getByBarcode(String barcode, {String? shopId});

  /// Liste bornée pour un carrousel d'accueil (populaire, nouveautés,
  /// promotions, recommandations…). Réseau seul, sans cache Drift : ce sont
  /// des sections secondaires, pas le flux hors-ligne principal. Renvoie une
  /// liste vide plutôt qu'une erreur si le réseau est indisponible — le
  /// carrousel se masque silencieusement.
  Future<List<Product>> fetchRail({
    String? categoryId,
    ProductSort sort = ProductSort.newest,
    bool onSale = false,
    bool flashOnly = false,
    double? minRating,
    int limit = 10,
  });

  /// Produits similaires : même catégorie, plus récents (§ décisions de
  /// portée — définition honnête, non personnalisée).
  Future<List<Product>> similarProducts(String productId);

  /// Produits recommandés : même catégorie, triés par popularité.
  Future<List<Product>> recommendedProducts(String productId);
}
