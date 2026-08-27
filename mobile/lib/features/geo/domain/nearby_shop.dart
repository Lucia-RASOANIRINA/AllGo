import 'package:freezed_annotation/freezed_annotation.dart';

part 'nearby_shop.freezed.dart';

/// Boutique renvoyée par `GET /geo/shops` — fonction WiFiMarkets.
///
/// `distanceM` est calculée par MongoDB sur l'ellipsoïde terrestre via
/// `$geoNear`, jamais côté client : recalculer une distance sur le téléphone
/// donnerait un tri différent de la pagination serveur, et donc des doublons.
@freezed
abstract class NearbyShop with _$NearbyShop {
  const factory NearbyShop({
    required String id,
    required String slug,
    required String name,
    required double latitude,
    required double longitude,
    required int distanceM,
    String? logo,
    String? categoryName,
    String? city,
    @Default(0) double rating,
    @Default(0) int reviewCount,
    @Default(0) int productCount,
    @Default(5) int deliveryRadiusKm,
  }) = _NearbyShop;

  const NearbyShop._();

  /// La boutique livre-t-elle jusqu'au point de recherche ?
  bool get deliversHere => distanceM <= deliveryRadiusKm * 1000;
}

/// Paramètres de recherche géographique.
class NearbyQuery {
  const NearbyQuery({
    required this.latitude,
    required this.longitude,
    this.radiusKm = 5,
    this.categoryId,
  });

  final double latitude;
  final double longitude;
  final double radiusKm;
  final String? categoryId;

  NearbyQuery copyWith({double? radiusKm, String? categoryId, bool clearCategory = false}) {
    return NearbyQuery(
      latitude: latitude,
      longitude: longitude,
      radiusKm: radiusKm ?? this.radiusKm,
      categoryId: clearCategory ? null : (categoryId ?? this.categoryId),
    );
  }
}

abstract interface class GeoRepository {
  Future<List<NearbyShop>> nearbyShops(NearbyQuery query);

  /// Position courante de l'appareil.
  ///
  /// Renvoie `null` si l'utilisateur refuse l'autorisation : le refus est un
  /// choix légitime, pas une erreur. L'écran retombe alors sur le centre de
  /// Mahajanga (§12.3 — consentement explicite pour la géolocalisation).
  Future<({double latitude, double longitude})?> currentPosition();
}
