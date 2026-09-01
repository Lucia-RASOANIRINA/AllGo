import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Boutique suivie, vue enrichie — `/me/follows/shops`, distinct de
/// `shopFollowControllerProvider` (identifiants seuls). Alimente l'onglet
/// « Boutiques » de l'écran Favoris.
class FollowedShop {
  const FollowedShop({
    required this.id,
    required this.slug,
    required this.name,
    this.logo,
    this.city,
    this.rating,
  });

  factory FollowedShop.fromJson(Map<String, dynamic> json) {
    final address = (json['address'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final stats = (json['stats'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final rating = stats['rating'];

    return FollowedShop(
      id: idFromJson(json),
      slug: json['slug'] as String? ?? '',
      name: json['name'] as String? ?? '',
      logo: json['logo'] as String?,
      city: address['city'] as String?,
      rating: rating == null ? null : doubleFromJson(rating),
    );
  }

  final String id;
  final String slug;
  final String name;
  final String? logo;
  final String? city;
  final double? rating;
}

class FollowedShopsState {
  const FollowedShopsState({required this.items, required this.hasMore, this.nextCursor});

  static const FollowedShopsState empty =
      FollowedShopsState(items: <FollowedShop>[], hasMore: false);

  final List<FollowedShop> items;
  final bool hasMore;
  final String? nextCursor;
}

class FollowedShopsController extends AutoDisposeAsyncNotifier<FollowedShopsState> {
  @override
  Future<FollowedShopsState> build() => _fetch();

  Future<void> loadMore() async {
    final current = state.valueOrNull;
    final cursor = current?.nextCursor;
    if (current == null || !current.hasMore || cursor == null) return;

    try {
      final next = await _fetch(cursor: cursor);
      state = AsyncData(
        FollowedShopsState(
          items: <FollowedShop>[...current.items, ...next.items],
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
        ),
      );
    } on DioException {
      // Silencieux : la page déjà chargée reste affichée.
    }
  }

  void removeLocally(String shopId) {
    final current = state.valueOrNull;
    if (current == null) return;
    state = AsyncData(
      FollowedShopsState(
        items: current.items.where((s) => s.id != shopId).toList(),
        hasMore: current.hasMore,
        nextCursor: current.nextCursor,
      ),
    );
  }

  Future<FollowedShopsState> _fetch({String? cursor}) async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/me/follows/shops',
      queryParameters: <String, dynamic>{'limit': 20, if (cursor != null) 'cursor': cursor},
    );

    final body = response.data!;
    final meta = body['meta'] as Map<String, dynamic>?;

    return FollowedShopsState(
      items: (body['data'] as List<dynamic>)
          .map((json) => FollowedShop.fromJson(json as Map<String, dynamic>))
          .toList(),
      hasMore: meta?['hasMore'] as bool? ?? false,
      nextCursor: meta?['nextCursor'] as String?,
    );
  }
}

final AutoDisposeAsyncNotifierProvider<FollowedShopsController, FollowedShopsState>
    followedShopsControllerProvider =
    AsyncNotifierProvider.autoDispose<FollowedShopsController, FollowedShopsState>(
  FollowedShopsController.new,
);
