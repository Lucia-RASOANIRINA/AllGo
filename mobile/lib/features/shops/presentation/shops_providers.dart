import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/features/shops/domain/shop_summary.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Parseur partagé — réutilisé par `shop_search_controller.dart` pour ne pas
/// dupliquer la lecture du contrat `GET /shops`.
ShopSummary shopSummaryFromJson(Map<String, dynamic> json) {
  final stats = (json['stats'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
  final address = (json['address'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
  final fulfillment = (json['fulfillment'] as Map<String, dynamic>?) ?? const <String, dynamic>{};

  return ShopSummary(
    id: idFromJson(json),
    slug: json['slug'] as String? ?? '',
    name: json['name'] as String? ?? '',
    logo: json['logo'] as String?,
    city: address['city'] as String?,
    rating: doubleFromJson(stats['rating']),
    followerCount: stats['followerCount'] as int? ?? 0,
    categoryId: json['categoryId'] as String?,
    categoryName: json['categoryName'] as String?,
    deliveryAvailable: fulfillment['delivery'] as bool? ?? true,
    pickupAvailable: fulfillment['pickup'] as bool? ?? false,
  );
}

/// Boutiques les plus suivies — rail « Boutiques populaires » de l'accueil.
///
/// Appel Dio direct, sans dépôt ni cache Drift : comme `categoryTreeProvider`,
/// c'est une section secondaire bornée (10 résultats), pas un flux principal
/// hors-ligne d'abord.
final AutoDisposeFutureProvider<List<ShopSummary>> popularShopsProvider =
    FutureProvider.autoDispose<List<ShopSummary>>((ref) async {
  try {
    final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>(
      '/shops',
      queryParameters: <String, dynamic>{'sort': 'popular', 'limit': 10},
    );

    return (response.data!['data'] as List<dynamic>)
        .map((json) => shopSummaryFromJson(json as Map<String, dynamic>))
        .toList();
  } on Exception {
    // Section secondaire : hors ligne, elle se masque plutôt que de casser
    // l'écran d'accueil.
    return const <ShopSummary>[];
  }
});
