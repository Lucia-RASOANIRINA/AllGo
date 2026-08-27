import 'package:allgo/core/error/failure.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Identifiants des produits favoris de l'utilisateur.
///
/// Un `Set` d'identifiants plutôt que la liste des fiches : la grille du
/// catalogue n'a besoin que de savoir quels cœurs colorer, et transporter les
/// fiches complètes pour cela coûterait des kilo-octets à chaque affichage.
class FavoritesController extends AsyncNotifier<Set<String>> {
  @override
  Future<Set<String>> build() async {
    if (!ref.watch(sessionControllerProvider).isAuthenticated) return <String>{};

    try {
      final response =
          await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me/favorites/ids');

      return (response.data!['data'] as List<dynamic>).map((id) => id as String).toSet();
    } on DioException catch (error) {
      // Hors ligne : aucun favori connu plutôt qu'un écran en erreur. Un cœur
      // gris est une gêne mineure ; une grille qui refuse de s'afficher, non.
      if (error.error is NetworkFailure) return <String>{};
      rethrow;
    }
  }

  bool contains(String productId) => state.valueOrNull?.contains(productId) ?? false;

  /// Bascule optimiste : le cœur change immédiatement, l'appel suit.
  ///
  /// En cas de refus du serveur, l'état est restauré — un cœur qui reste plein
  /// alors que le favori n'a pas été enregistré ment à l'utilisateur.
  Future<void> toggle(String productId) async {
    final current = state.valueOrNull ?? <String>{};
    final wasFavorite = current.contains(productId);

    state = AsyncData(
      wasFavorite
          ? (current.where((id) => id != productId).toSet())
          : <String>{...current, productId},
    );

    try {
      final api = ref.read(apiClientProvider);
      if (wasFavorite) {
        await api.delete<void>('/me/favorites/$productId');
      } else {
        await api.post<void>(
          '/me/favorites',
          data: <String, String>{'productId': productId},
        );
      }
    } on DioException {
      state = AsyncData(current);
      rethrow;
    }
  }
}

final AsyncNotifierProvider<FavoritesController, Set<String>> favoritesControllerProvider =
    AsyncNotifierProvider<FavoritesController, Set<String>>(FavoritesController.new);
