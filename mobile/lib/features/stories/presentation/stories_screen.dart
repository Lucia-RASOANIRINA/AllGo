import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/stories/presentation/story_stats_screen.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

final storiesProvider =
    FutureProvider.autoDispose<List<StoryData>>((ref) async {
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/social/stories');
  final raw = response.data?['data'];
  if (raw is! List<dynamic>) return const <StoryData>[];
  return raw
      .whereType<Map<String, dynamic>>()
      .map(StoryData.fromJson)
      .toList();
});

class StoriesScreen extends ConsumerStatefulWidget {
  const StoriesScreen({super.key});

  @override
  ConsumerState<StoriesScreen> createState() => _StoriesScreenState();
}

class _StoriesScreenState extends ConsumerState<StoriesScreen> {
  final _seen = <String>{};

  void _markViewed(StoryData story) {
    if (!_seen.add(story.id)) return;
    unawaited(ref.read(apiClientProvider).post<void>('/social/stories/${story.id}/view'));
  }

  @override
  Widget build(BuildContext context) {
    final stories = ref.watch(storiesProvider);
    final myUserId = ref.watch(sessionControllerProvider).userId;

    return Scaffold(
      backgroundColor: Colors.black,
      body: stories.when(
        loading: () => const Center(child: CircularProgressIndicator(color: Colors.white)),
        error: (_, __) => const Center(
          child: Text('Stories indisponibles hors ligne.', style: TextStyle(color: Colors.white)),
        ),
        data: (list) {
          if (list.isEmpty) {
            return Stack(
              children: <Widget>[
                const Center(
                  child: Text('Aucune story pour l’instant.', style: TextStyle(color: Colors.white)),
                ),
                SafeArea(
                  child: IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, color: Colors.white),
                  ),
                ),
              ],
            );
          }

          WidgetsBinding.instance.addPostFrameCallback((_) => _markViewed(list.first));

          return PageView.builder(
            itemCount: list.length,
            onPageChanged: (index) => _markViewed(list[index]),
            itemBuilder: (context, index) {
              final story = list[index];
              return Stack(
                fit: StackFit.expand,
                children: <Widget>[
                  CachedNetworkImage(
                    imageUrl: story.image,
                    fit: BoxFit.cover,
                    placeholder: (_, __) => Container(color: Colors.black87),
                    errorWidget: (_, __, ___) =>
                        const Icon(Icons.image_not_supported, color: Colors.white),
                  ),
                  Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: <Color>[
                          Colors.black.withValues(alpha: 0.08),
                          Colors.black.withValues(alpha: 0.7),
                        ],
                      ),
                    ),
                  ),
                  SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.all(AllGoTokens.space4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            children: <Widget>[
                              IconButton(
                                onPressed: () => Navigator.of(context).pop(),
                                icon: const Icon(Icons.close, color: Colors.white),
                              ),
                              const SizedBox(width: AllGoTokens.space2),
                              Text(
                                story.author,
                                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                              ),
                              if (myUserId != null && story.authorId == myUserId) ...<Widget>[
                                const Spacer(),
                                IconButton(
                                  onPressed: () => Navigator.of(context).push(
                                    MaterialPageRoute<void>(
                                      builder: (_) => StoryStatsScreen(storyId: story.id),
                                    ),
                                  ),
                                  icon: const Icon(Icons.insights_outlined, color: Colors.white),
                                  tooltip: 'Statistiques',
                                ),
                              ],
                            ],
                          ),
                          const Spacer(),
                          if (story.productId != null)
                            Padding(
                              padding: const EdgeInsets.only(bottom: AllGoTokens.space3),
                              child: OutlinedButton.icon(
                                style: OutlinedButton.styleFrom(foregroundColor: Colors.white),
                                onPressed: () {
                                  Navigator.of(context).pop();
                                  context.push(Routes.productPath(story.productId!));
                                },
                                icon: const Icon(Icons.shopping_bag_outlined),
                                label: const Text('Voir le produit'),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}

class StoryData {
  const StoryData({
    required this.id,
    required this.authorId,
    required this.author,
    required this.image,
    this.productId,
    this.promotionId,
  });

  final String id;
  final String authorId;
  final String author;
  final String image;
  final String? productId;
  final String? promotionId;

  factory StoryData.fromJson(Map<String, dynamic> json) {
    final author = json['author'] is Map<String, dynamic>
        ? json['author'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final media = json['media'] is Map<String, dynamic>
        ? json['media'] as Map<String, dynamic>
        : const <String, dynamic>{};
    return StoryData(
      id: idFromJson(json),
      authorId: json['authorId']?.toString() ?? '',
      author: author['name'] as String? ?? 'AllGo',
      image: media['url'] as String? ?? '',
      productId: json['productId']?.toString(),
      promotionId: json['promotionId']?.toString(),
    );
  }
}
