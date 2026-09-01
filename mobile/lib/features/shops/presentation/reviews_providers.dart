import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Avis client sur une boutique — `GET/POST /reviews` avec
/// `targetType=shop` (endpoint générique, partagé avec les avis produit et
/// livreur — voir `backend/.../reviews.controller.ts`).
class Review {
  const Review({
    required this.id,
    required this.userId,
    required this.authorName,
    required this.rating,
    required this.createdAt,
    this.authorAvatar,
    this.comment,
  });

  factory Review.fromJson(Map<String, dynamic> json) {
    final author = (json['author'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    return Review(
      id: idFromJson(json),
      userId: json['userId'] as String,
      authorName: author['name'] as String? ?? '',
      authorAvatar: author['avatar'] as String?,
      rating: (json['rating'] as num).round(),
      comment: json['comment'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String userId;
  final String authorName;
  final String? authorAvatar;
  final int rating;
  final String? comment;
  final DateTime createdAt;
}

class ReviewsState {
  const ReviewsState({required this.items, required this.hasMore, this.nextCursor});

  static const ReviewsState empty = ReviewsState(items: <Review>[], hasMore: false);

  final List<Review> items;
  final bool hasMore;
  final String? nextCursor;
}

/// Liste paginée + dépôt/retrait de mon propre avis, par boutique.
class ReviewsController extends AutoDisposeFamilyAsyncNotifier<ReviewsState, String> {
  @override
  Future<ReviewsState> build(String shopId) => _fetch();

  Future<void> loadMore() async {
    final current = state.valueOrNull;
    final cursor = current?.nextCursor;
    if (current == null || !current.hasMore || cursor == null) return;

    try {
      final next = await _fetch(cursor: cursor);
      state = AsyncData(
        ReviewsState(
          items: <Review>[...current.items, ...next.items],
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
        ),
      );
    } on DioException {
      // Silencieux : la page déjà chargée reste affichée.
    }
  }

  /// Dépose un avis, puis rafraîchit la première page — plus simple et tout
  /// aussi correct qu'une fusion en mémoire vu le faible volume d'avis par
  /// boutique. Un avis n'est possible qu'à partir d'une commande livrée dans
  /// cette boutique (§ éligibilité côté API) : `orderId` est obligatoire.
  Future<void> post(String orderId, int rating, String? comment) async {
    await ref.read(apiClientProvider).post<void>(
      '/reviews',
      data: <String, dynamic>{
        'orderId': orderId,
        'targetType': 'shop',
        'targetId': arg,
        'rating': rating,
        if (comment != null) 'comment': comment,
      },
    );
    state = AsyncData(await _fetch());
  }

  Future<void> remove(String reviewId) async {
    await ref.read(apiClientProvider).delete<void>('/reviews/$reviewId');
    state = AsyncData(await _fetch());
  }

  Future<ReviewsState> _fetch({String? cursor}) async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/reviews',
      queryParameters: <String, dynamic>{
        'targetType': 'shop',
        'targetId': arg,
        'limit': 20,
        if (cursor != null) 'cursor': cursor,
      },
    );

    final body = response.data!;
    final meta = body['meta'] as Map<String, dynamic>?;

    return ReviewsState(
      items: (body['data'] as List<dynamic>)
          .map((json) => Review.fromJson(json as Map<String, dynamic>))
          .toList(),
      hasMore: meta?['hasMore'] as bool? ?? false,
      nextCursor: meta?['nextCursor'] as String?,
    );
  }
}

final AutoDisposeAsyncNotifierProviderFamily<ReviewsController, ReviewsState, String>
    reviewsControllerProvider =
    AsyncNotifierProvider.autoDispose.family<ReviewsController, ReviewsState, String>(
  ReviewsController.new,
);
