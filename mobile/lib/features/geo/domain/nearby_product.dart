import 'package:freezed_annotation/freezed_annotation.dart';

part 'nearby_product.freezed.dart';

/// Produit renvoyé par `GET /geo/products` — même principe que `NearbyShop` :
/// `distanceM` est calculée côté serveur par `$geoNear`, jamais recalculée
/// sur l'appareil.
@freezed
abstract class NearbyProduct with _$NearbyProduct {
  const factory NearbyProduct({
    required String id,
    required String name,
    required int price,
    required int distanceM,
    required double latitude,
    required double longitude,
    String? slug,
    int? promoPrice,
    String? thumbUrl,
    String? shopId,
    String? shopName,
  }) = _NearbyProduct;
}
