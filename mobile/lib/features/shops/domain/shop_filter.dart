/// Filtres de recherche boutiques — même style que `ProductFilter`
/// (`features/catalog/domain/repositories/product_repository.dart`).
class ShopFilter {
  const ShopFilter({
    this.query,
    this.categoryId,
    this.delivery = false,
    this.pickup = false,
    this.openNow = false,
    this.minRating,
    this.onlyNearby = false,
    this.radiusKm = 5,
  });

  final String? query;
  final String? categoryId;
  final bool delivery;
  final bool pickup;
  final bool openNow;
  final double? minRating;

  /// Bascule « Proches » : interroge `/geo/shops` au lieu de `/shops`.
  final bool onlyNearby;
  final double radiusKm;

  /// Copie partielle. Pour **retirer** un filtre, utiliser `clearX` — un
  /// `copyWith(x: null)` ne saurait pas distinguer « inchangé » de « effacé ».
  ShopFilter copyWith({
    String? query,
    String? categoryId,
    bool? delivery,
    bool? pickup,
    bool? openNow,
    double? minRating,
    bool? onlyNearby,
    double? radiusKm,
  }) {
    return ShopFilter(
      query: query ?? this.query,
      categoryId: categoryId ?? this.categoryId,
      delivery: delivery ?? this.delivery,
      pickup: pickup ?? this.pickup,
      openNow: openNow ?? this.openNow,
      minRating: minRating ?? this.minRating,
      onlyNearby: onlyNearby ?? this.onlyNearby,
      radiusKm: radiusKm ?? this.radiusKm,
    );
  }

  ShopFilter clearQuery() => ShopFilter(
        categoryId: categoryId,
        delivery: delivery,
        pickup: pickup,
        openNow: openNow,
        minRating: minRating,
        onlyNearby: onlyNearby,
        radiusKm: radiusKm,
      );

  ShopFilter clearCategory() => ShopFilter(
        query: query,
        delivery: delivery,
        pickup: pickup,
        openNow: openNow,
        minRating: minRating,
        onlyNearby: onlyNearby,
        radiusKm: radiusKm,
      );

  ShopFilter clearRating() => ShopFilter(
        query: query,
        categoryId: categoryId,
        delivery: delivery,
        pickup: pickup,
        openNow: openNow,
        onlyNearby: onlyNearby,
        radiusKm: radiusKm,
      );
}
