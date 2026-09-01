import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final storiesProvider =
    FutureProvider.autoDispose<List<_StoryData>>((ref) async {
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/social/stories');
  final raw = response.data?['data'];
  if (raw is! List<dynamic>) return const <_StoryData>[];
  return raw
      .whereType<Map<String, dynamic>>()
      .map(_StoryData.fromJson)
      .toList();
});

class StoriesScreen extends ConsumerWidget {
  const StoriesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final remoteStories = ref.watch(storiesProvider).valueOrNull;
    final demoStories = <_StoryData>[
      _StoryData(
        author: 'Amina',
        subtitle: 'Nouvelle collection de mode locale',
        image:
            'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1200&q=80',
      ),
      _StoryData(
        author: 'Mihary',
        subtitle: 'Promo du week-end sur les aliments frais',
        image:
            'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80',
      ),
      _StoryData(
        author: 'Naina',
        subtitle: 'Offre du jour — accessoires tech en stock',
        image:
            'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1200&q=80',
      ),
    ];
    final stories = remoteStories == null || remoteStories.isEmpty
        ? demoStories
        : remoteStories;

    return Scaffold(
      backgroundColor: Colors.black,
      body: PageView.builder(
        itemCount: stories.length,
        itemBuilder: (context, index) {
          final story = stories[index];
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
                    colors: [
                      Colors.black.withOpacity(0.08),
                      Colors.black.withOpacity(0.7)
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
                            style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700),
                          ),
                          const Spacer(),
                          const Text('08:12',
                              style: TextStyle(color: Colors.white70)),
                        ],
                      ),
                      const Spacer(),
                      Container(
                        padding: const EdgeInsets.all(AllGoTokens.space3),
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.25),
                          borderRadius:
                              BorderRadius.circular(AllGoTokens.radiusCard),
                        ),
                        child: Text(
                          story.subtitle,
                          style: const TextStyle(
                              color: Colors.white, fontSize: 18),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _StoryData {
  const _StoryData(
      {required this.author, required this.subtitle, required this.image});

  final String author;
  final String subtitle;
  final String image;

  factory _StoryData.fromJson(Map<String, dynamic> json) {
    final author = json['author'] is Map<String, dynamic>
        ? json['author'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final media = json['media'] is Map<String, dynamic>
        ? json['media'] as Map<String, dynamic>
        : const <String, dynamic>{};
    return _StoryData(
      author: author['name'] as String? ?? 'AllGo',
      subtitle: 'Story publiée sur AllGo',
      image: media['url'] as String? ?? '',
    );
  }
}
