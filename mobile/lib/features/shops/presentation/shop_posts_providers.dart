import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Publication d'une boutique — lecture seule côté client (§ décisions de
/// portée : pas de composeur, c'est un geste commerçant, lot L5).
class ShopPost {
  const ShopPost({
    required this.id,
    required this.reactionCount,
    required this.commentCount,
    required this.createdAt,
    this.content,
    this.thumbUrl,
    // Vrai uniquement si l'utilisateur a réagi PENDANT cette session : aucune
    // route ne renvoie l'historique de mes réactions passées (§ portée).
    this.reactedLocally = false,
  });

  factory ShopPost.fromJson(Map<String, dynamic> json) {
    final counters = (json['counters'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    final media = (json['media'] as List<dynamic>?) ?? const <dynamic>[];
    final main = media.isEmpty ? null : media.first as Map<String, dynamic>;

    return ShopPost(
      id: idFromJson(json),
      content: json['content'] as String?,
      thumbUrl: main?['thumbUrl'] as String? ?? main?['url'] as String?,
      reactionCount: counters['reactions'] as int? ?? 0,
      commentCount: counters['comments'] as int? ?? 0,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String? content;
  final String? thumbUrl;
  final int reactionCount;
  final int commentCount;
  final bool reactedLocally;
  final DateTime createdAt;

  ShopPost copyWith({int? reactionCount, bool? reactedLocally}) => ShopPost(
        id: id,
        content: content,
        thumbUrl: thumbUrl,
        reactionCount: reactionCount ?? this.reactionCount,
        commentCount: commentCount,
        reactedLocally: reactedLocally ?? this.reactedLocally,
        createdAt: createdAt,
      );
}

class ShopPostsState {
  const ShopPostsState({required this.items, required this.hasMore, this.nextCursor});

  static const ShopPostsState empty = ShopPostsState(items: <ShopPost>[], hasMore: false);

  final List<ShopPost> items;
  final bool hasMore;
  final String? nextCursor;
}

class ShopPostsController extends AutoDisposeFamilyAsyncNotifier<ShopPostsState, String> {
  @override
  Future<ShopPostsState> build(String shopId) => _fetch();

  Future<void> loadMore() async {
    final current = state.valueOrNull;
    final cursor = current?.nextCursor;
    if (current == null || !current.hasMore || cursor == null) return;

    try {
      final next = await _fetch(cursor: cursor);
      state = AsyncData(
        ShopPostsState(
          items: <ShopPost>[...current.items, ...next.items],
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
        ),
      );
    } on DioException {
      // Silencieux : la page déjà chargée reste affichée.
    }
  }

  /// Bascule optimiste — même motif que `FavoritesController.toggle`.
  Future<void> toggleReaction(String postId) async {
    final current = state.valueOrNull;
    if (current == null) return;

    final index = current.items.indexWhere((p) => p.id == postId);
    if (index == -1) return;
    final post = current.items[index];
    final wasReacted = post.reactedLocally;

    final updated = List<ShopPost>.of(current.items);
    updated[index] = post.copyWith(
      reactionCount: post.reactionCount + (wasReacted ? -1 : 1),
      reactedLocally: !wasReacted,
    );
    state = AsyncData(ShopPostsState(items: updated, hasMore: current.hasMore, nextCursor: current.nextCursor));

    try {
      final api = ref.read(apiClientProvider);
      if (wasReacted) {
        await api.delete<void>('/posts/$postId/reactions');
      } else {
        await api.post<void>('/posts/$postId/reactions');
      }
    } on DioException {
      state = AsyncData(current);
      rethrow;
    }
  }

  Future<ShopPostsState> _fetch({String? cursor}) async {
    final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
      '/shops/$arg/posts',
      queryParameters: <String, dynamic>{'limit': 10, if (cursor != null) 'cursor': cursor},
    );

    final body = response.data!;
    final meta = body['meta'] as Map<String, dynamic>?;

    return ShopPostsState(
      items: (body['data'] as List<dynamic>)
          .map((json) => ShopPost.fromJson(json as Map<String, dynamic>))
          .toList(),
      hasMore: meta?['hasMore'] as bool? ?? false,
      nextCursor: meta?['nextCursor'] as String?,
    );
  }
}

final AutoDisposeAsyncNotifierProviderFamily<ShopPostsController, ShopPostsState, String>
    shopPostsControllerProvider =
    AsyncNotifierProvider.autoDispose.family<ShopPostsController, ShopPostsState, String>(
  ShopPostsController.new,
);

/// Commentaire d'une publication.
class PostComment {
  const PostComment({
    required this.id,
    required this.authorName,
    required this.content,
    required this.createdAt,
    this.authorAvatar,
  });

  factory PostComment.fromJson(Map<String, dynamic> json) {
    final author = (json['author'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
    return PostComment(
      id: idFromJson(json),
      authorName: author['name'] as String? ?? '',
      authorAvatar: author['avatar'] as String?,
      content: json['content'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  final String id;
  final String authorName;
  final String? authorAvatar;
  final String content;
  final DateTime createdAt;
}

/// Commentaires d'une publication, par identifiant de publication.
class PostCommentsController extends AutoDisposeFamilyAsyncNotifier<List<PostComment>, String> {
  @override
  Future<List<PostComment>> build(String postId) async {
    final response = await ref
        .read(apiClientProvider)
        .get<Map<String, dynamic>>('/posts/$postId/comments', queryParameters: <String, dynamic>{'limit': 50});

    return (response.data!['data'] as List<dynamic>)
        .map((json) => PostComment.fromJson(json as Map<String, dynamic>))
        .toList();
  }

  Future<void> add(String content) async {
    final response = await ref.read(apiClientProvider).post<Map<String, dynamic>>(
      '/posts/$arg/comments',
      data: <String, String>{'content': content},
    );

    final created = PostComment.fromJson(response.data!['data'] as Map<String, dynamic>);
    state = AsyncData(<PostComment>[...state.valueOrNull ?? const <PostComment>[], created]);
  }
}

final AutoDisposeAsyncNotifierProviderFamily<PostCommentsController, List<PostComment>, String>
    postCommentsControllerProvider =
    AsyncNotifierProvider.autoDispose.family<PostCommentsController, List<PostComment>, String>(
  PostCommentsController.new,
);
