import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class StoryViewer {
  const StoryViewer({required this.name, required this.viewedAt, this.avatar});

  final String name;
  final String? avatar;
  final DateTime viewedAt;

  factory StoryViewer.fromJson(Map<String, dynamic> json) => StoryViewer(
        name: json['name'] as String? ?? 'Membre AllGo',
        avatar: json['avatar'] as String?,
        viewedAt: DateTime.tryParse(json['viewedAt'] as String? ?? '') ?? DateTime.now(),
      );
}

class StoryStats {
  const StoryStats({required this.viewCount, required this.viewers});

  final int viewCount;
  final List<StoryViewer> viewers;

  factory StoryStats.fromJson(Map<String, dynamic> json) {
    final rawViewers = (json['viewers'] as List<dynamic>?) ?? const <dynamic>[];
    return StoryStats(
      viewCount: json['viewCount'] as int? ?? 0,
      viewers: rawViewers
          .whereType<Map<String, dynamic>>()
          .map(StoryViewer.fromJson)
          .toList()
        ..sort((a, b) => b.viewedAt.compareTo(a.viewedAt)),
    );
  }
}

final AutoDisposeFutureProviderFamily<StoryStats, String> storyStatsProvider =
    FutureProvider.autoDispose.family<StoryStats, String>((ref, storyId) async {
  final response =
      await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/social/stories/$storyId/viewers');
  final data = response.data?['data'] as Map<String, dynamic>? ?? const <String, dynamic>{};
  return StoryStats.fromJson(data);
});

/// Statistiques d'une story — réservées à son auteur (§12). Point d'entrée :
/// le bouton "Statistiques" affiché uniquement quand on visionne sa propre
/// story (`StoriesScreen`).
class StoryStatsScreen extends ConsumerWidget {
  const StoryStatsScreen({required this.storyId, super.key});

  final String storyId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stats = ref.watch(storyStatsProvider(storyId));

    return Scaffold(
      appBar: AppBar(title: const Text('Statistiques de la story')),
      body: AsyncView<StoryStats>(
        value: stats,
        isEmpty: (data) => data.viewers.isEmpty,
        emptyTitle: 'Aucune vue pour l’instant',
        emptyMessage: 'Les personnes ayant consulté votre story apparaîtront ici.',
        onRetry: () => ref.invalidate(storyStatsProvider(storyId)),
        data: (data) => ListView(
          padding: const EdgeInsets.all(AllGoTokens.space4),
          children: <Widget>[
            Card(
              child: ListTile(
                leading: const Icon(Icons.visibility_outlined),
                title: const Text('Vues totales'),
                trailing: Text(
                  '${data.viewCount}',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
            ),
            const SizedBox(height: AllGoTokens.space4),
            Text('Personnes ayant consulté', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: AllGoTokens.space2),
            for (final viewer in data.viewers)
              ListTile(
                leading: CircleAvatar(
                  backgroundImage: viewer.avatar == null ? null : CachedNetworkImageProvider(viewer.avatar!),
                  child: viewer.avatar == null ? const Icon(Icons.person_outline) : null,
                ),
                title: Text(viewer.name),
                trailing: Text(_formatTime(viewer.viewedAt)),
              ),
          ],
        ),
      ),
    );
  }

  String _formatTime(DateTime date) =>
      '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}
