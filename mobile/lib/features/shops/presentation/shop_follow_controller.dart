import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Identifiants des boutiques suivies — même principe que `FavoritesController`,
/// mais côté boutique. `Suivre` et `Ajouter aux favoris (boutique)` sont
/// fusionnés en une seule action : `Favorite` reste strictement produit.
class ShopFollowController extends AsyncNotifier<Set<String>> {
  @override
  Future<Set<String>> build() async {
    if (!ref.watch(sessionControllerProvider).isAuthenticated) return <String>{};

    try {
      final response =
          await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me/follows/shops/ids');

      return (response.data!['data'] as List<dynamic>).map((id) => id as String).toSet();
    } on DioException catch (error) {
      if (error.error is NetworkFailure) return <String>{};
      rethrow;
    }
  }

  bool contains(String shopId) => state.valueOrNull?.contains(shopId) ?? false;

  /// Bascule optimiste — voir `FavoritesController.toggle` pour la justification.
  Future<void> toggle(String shopId) async {
    final current = state.valueOrNull ?? <String>{};
    final wasFollowing = current.contains(shopId);

    state = AsyncData(
      wasFollowing
          ? (current.where((id) => id != shopId).toSet())
          : <String>{...current, shopId},
    );

    try {
      final api = ref.read(apiClientProvider);
      if (wasFollowing) {
        await api.delete<void>('/me/follows/shops/$shopId');
      } else {
        await api.post<void>('/me/follows/shops/$shopId');
      }
    } on DioException {
      state = AsyncData(current);
      rethrow;
    }
  }
}

final AsyncNotifierProvider<ShopFollowController, Set<String>> shopFollowControllerProvider =
    AsyncNotifierProvider<ShopFollowController, Set<String>>(ShopFollowController.new);
