import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Avis client sur un produit — `GET/POST /reviews` avec
/// `targetType=product`. Copie structurelle de
/// `shops/presentation/reviews_providers.dart` : même motif, cible différente.
class ProductReview {
  const ProductReview({
    required this.id,
    required this.userId,
    required this.authorName,
    required this.rating,
    required this.createdAt,
    this.authorAvatar,
    this.comment,
  });

  factory ProductReview.fromJson(Map<String, dynamic> json) {
    final author = (json['author'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    return ProductReview(
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

class ProductReviewsState {
  const ProductReviewsState({required this.items, required this.hasMore, this.nextCursor});

  static const ProductReviewsState empty = ProductReviewsState(items: <ProductReview>[], hasMore: false);

  final List<ProductReview> items;
  final bool hasMore;
  final String? nextCursor;
}

/// Liste paginée + dépôt/retrait de mon propre avis, par produit.
class ProductReviewsController extends AutoDisposeFamilyAsyncNotifier<ProductReviewsState, String> {
  @override
  Future<ProductReviewsState> build(String productId) => _fetch();

  Future<void> loadMore() async {
    final current = state.valueOrNull;
    final cursor = current?.nextCursor;
    if (current == null || !current.hasMore || cursor == null) return;

    try {
      final next = await _fetch(cursor: cursor);
      state = AsyncData(
        ProductReviewsState(
          items: <ProductReview>[...current.items, ...next.items],
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
        ),
      );
    } on DioException {
      // Silencieux : la page déjà chargée reste affichée.
    }
  }

  /// Un avis n'est possible qu'à partir d'une commande livrée contenant ce
  /// produit (§ éligibilité côté API) : `orderId` est obligatoire.
  Future<void> post(String orderId, int rating, String? comment) async {
    await ref.read(apiClientProvider).post<void>(
      '/reviews',
      data: <String, dynamic>{
        'orderId': orderId,
        'targetType': 'product',
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

  Future<ProductReviewsState> _fetch({String? cursor}) async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/reviews',
      queryParameters: <String, dynamic>{
        'targetType': 'product',
        'targetId': arg,
        'limit': 20,
        if (cursor != null) 'cursor': cursor,
      },
    );

    final body = response.data!;
    final meta = body['meta'] as Map<String, dynamic>?;

    return ProductReviewsState(
      items: (body['data'] as List<dynamic>)
          .map((json) => ProductReview.fromJson(json as Map<String, dynamic>))
          .toList(),
      hasMore: meta?['hasMore'] as bool? ?? false,
      nextCursor: meta?['nextCursor'] as String?,
    );
  }
}

final AutoDisposeAsyncNotifierProviderFamily<ProductReviewsController, ProductReviewsState, String>
    productReviewsControllerProvider =
    AsyncNotifierProvider.autoDispose.family<ProductReviewsController, ProductReviewsState, String>(
  ProductReviewsController.new,
);
