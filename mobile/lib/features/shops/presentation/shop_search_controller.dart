import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/geo/domain/nearby_shop.dart';
import 'package:allgo/features/geo/presentation/geo_providers.dart';
import 'package:allgo/features/shops/domain/shop_filter.dart';
import 'package:allgo/features/shops/domain/shop_summary.dart';
import 'package:allgo/features/shops/presentation/shops_providers.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Filtre actif de l'onglet Boutiques d'Explorer.
final StateProvider<ShopFilter> shopSearchFilterProvider =
    StateProvider<ShopFilter>((_) => const ShopFilter());

class ShopSearchState {
  const ShopSearchState({required this.items, required this.hasMore, this.nextCursor});

  static const ShopSearchState empty = ShopSearchState(items: <ShopSummary>[], hasMore: false);

  final List<ShopSummary> items;
  final bool hasMore;
  final String? nextCursor;
}

/// Recherche de boutiques — pendant équivalent de `catalogProvider` côté
/// boutiques, mais sans cache Drift : une recherche n'a pas besoin de
/// fonctionner hors ligne (§9.1 s'applique au catalogue principal, pas ici).
class ShopSearchController extends AsyncNotifier<ShopSearchState> {
  @override
  Future<ShopSearchState> build() {
    final filter = ref.watch(shopSearchFilterProvider);
    return _fetch(filter);
  }

  /// Page suivante — indisponible en mode « Proches » (liste déjà bornée par
  /// `limit`, pas de curseur serveur dans ce mode).
  Future<void> loadMore() async {
    final current = state.valueOrNull;
    final cursor = current?.nextCursor;
    if (current == null || !current.hasMore || cursor == null) return;

    final filter = ref.read(shopSearchFilterProvider);
    if (filter.onlyNearby) return;

    try {
      final next = await _fetchPage(filter, cursor: cursor);
      state = AsyncData(
        ShopSearchState(
          items: <ShopSummary>[...current.items, ...next.items],
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
        ),
      );
    } on DioException {
      // Silencieux : la page déjà chargée reste affichée, l'utilisateur peut
      // retenter en tirant à nouveau la liste.
    }
  }

  Future<ShopSearchState> _fetch(ShopFilter filter) async {
    if (!filter.onlyNearby) return _fetchPage(filter);

    try {
      final position = await ref.watch(currentPositionProvider.future);
      final nearby = await ref.watch(geoRepositoryProvider).nearbyShops(
            NearbyQuery(
              latitude: position.latitude,
              longitude: position.longitude,
              radiusKm: filter.radiusKm,
              categoryId: filter.categoryId,
            ),
          );

      // Pas de recherche géo + texte combinée côté serveur (§ plan) : le
      // filtre texte s'applique en mémoire sur la liste déjà bornée reçue.
      final query = filter.query?.trim().toLowerCase();
      final filtered = (query == null || query.isEmpty)
          ? nearby
          : nearby.where((s) => s.name.toLowerCase().contains(query)).toList();

      return ShopSearchState(items: filtered.map(_fromNearby).toList(), hasMore: false);
    } on Exception {
      return ShopSearchState.empty;
    }
  }

  Future<ShopSearchState> _fetchPage(ShopFilter filter, {String? cursor}) async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/shops',
      queryParameters: <String, dynamic>{
        'limit': 20,
        if (cursor != null) 'cursor': cursor,
        if (filter.query != null && filter.query!.isNotEmpty) 'q': filter.query,
        if (filter.categoryId != null) 'category': filter.categoryId,
        if (filter.delivery) 'delivery': true,
        if (filter.pickup) 'pickup': true,
        if (filter.openNow) 'openNow': true,
        if (filter.minRating != null) 'minRating': filter.minRating,
      },
    );

    final body = response.data!;
    final meta = body['meta'] as Map<String, dynamic>?;

    return ShopSearchState(
      items: (body['data'] as List<dynamic>)
          .map((json) => shopSummaryFromJson(json as Map<String, dynamic>))
          .toList(),
      hasMore: meta?['hasMore'] as bool? ?? false,
      nextCursor: meta?['nextCursor'] as String?,
    );
  }

  ShopSummary _fromNearby(NearbyShop shop) => ShopSummary(
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        logo: shop.logo,
        city: shop.city,
        rating: shop.rating,
        distanceM: shop.distanceM,
      );
}

final AsyncNotifierProvider<ShopSearchController, ShopSearchState> shopSearchControllerProvider =
    AsyncNotifierProvider<ShopSearchController, ShopSearchState>(ShopSearchController.new);
