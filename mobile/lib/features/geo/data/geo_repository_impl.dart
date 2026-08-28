import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/features/geo/domain/nearby_product.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:dio/dio.dart';
import 'package:geolocator/geolocator.dart';

class GeoRepositoryImpl implements GeoRepository {
  GeoRepositoryImpl(this._dio);

  final Dio _dio;

  @override
  Future<List<NearbyShop>> nearbyShops(NearbyQuery query) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/geo/shops',
      queryParameters: <String, dynamic>{
        'lat': query.latitude,
        'lng': query.longitude,
        'radius': query.radiusKm,
        if (query.categoryId != null) 'category': query.categoryId,
        if (query.openNow) 'openNow': true,
        if (query.closedNow) 'closedNow': true,
        'limit': 50,
      },
    );

    return (response.data!['data'] as List<dynamic>)
        .map((json) => _fromJson(json as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<List<NearbyProduct>> nearbyProducts(NearbyQuery query) async {
    final response = await _dio.get<Map<String, dynamic>>(
      '/geo/products',
      queryParameters: <String, dynamic>{
        'lat': query.latitude,
        'lng': query.longitude,
        'radius': query.radiusKm,
        if (query.categoryId != null) 'category': query.categoryId,
        'limit': 50,
      },
    );

    return (response.data!['data'] as List<dynamic>)
        .map((json) => _productFromJson(json as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<({double latitude, double longitude})?> currentPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) return null;

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      return null;
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        // `medium` suffit à trouver les commerces d'un quartier, et consomme
        // nettement moins de batterie que `best` — décisif sur un terminal
        // d'entrée de gamme en fin de journée.
        accuracy: LocationAccuracy.medium,
        timeLimit: Duration(seconds: 15),
      ),
    );

    return (latitude: position.latitude, longitude: position.longitude);
  }

  NearbyShop _fromJson(Map<String, dynamic> json) {
    // ATTENTION : `coordinates` est en GeoJSON, donc [longitude, latitude].
    // L'inversion est l'erreur classique — et silencieuse : la carte
    // s'affiche, les marqueurs sont simplement au mauvais endroit.
    final coordinates =
        ((json['location'] as Map<String, dynamic>?)?['coordinates'] as List<dynamic>?) ??
            const <dynamic>[0, 0];

    final stats = (json['stats'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final address = (json['address'] as Map<String, dynamic>?) ?? const <String, dynamic>{};

    return NearbyShop(
      id: idFromJson(json),
      slug: json['slug'] as String? ?? '',
      name: json['name'] as String,
      logo: json['logo'] as String?,
      categoryName: json['categoryName'] as String?,
      city: address['city'] as String?,
      longitude: doubleFromJson(coordinates[0]),
      latitude: doubleFromJson(coordinates[1]),
      distanceM: (json['distanceM'] as num?)?.round() ?? 0,
      rating: doubleFromJson(stats['rating']),
      reviewCount: stats['reviewCount'] as int? ?? 0,
      productCount: stats['productCount'] as int? ?? 0,
      deliveryRadiusKm: json['deliveryRadiusKm'] as int? ?? 5,
    );
  }

  NearbyProduct _productFromJson(Map<String, dynamic> json) {
    final media = (json['media'] as List<dynamic>?) ?? const <dynamic>[];
    final main = media.isEmpty ? null : media.first as Map<String, dynamic>;
    final shop = (json['shop'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    // ATTENTION : `coordinates` est en GeoJSON, donc [longitude, latitude].
    final coordinates =
        ((json['location'] as Map<String, dynamic>?)?['coordinates'] as List<dynamic>?) ??
            const <dynamic>[0, 0];

    return NearbyProduct(
      id: idFromJson(json),
      name: json['name'] as String? ?? '',
      price: moneyFromJson(json['price']),
      promoPrice: json['promoPrice'] == null ? null : moneyFromJson(json['promoPrice']),
      distanceM: (json['distanceM'] as num?)?.round() ?? 0,
      longitude: doubleFromJson(coordinates[0]),
      latitude: doubleFromJson(coordinates[1]),
      slug: json['slug'] as String?,
      thumbUrl: main?['thumbUrl'] as String?,
      shopId: json['shopId'] as String?,
      shopName: shop['name'] as String?,
    );
  }
}
