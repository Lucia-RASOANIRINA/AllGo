import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

final socialPostsProvider =
    FutureProvider.autoDispose<List<_PostData>>((ref) async {
  final response = await ref
      .watch(apiClientProvider)
      .get<Map<String, dynamic>>('/social/posts');
  final raw = response.data?['data'];
  final values = raw is Map<String, dynamic> ? raw['items'] : raw;
  if (values is! List<dynamic>) return const <_PostData>[];
  return values
      .whereType<Map<String, dynamic>>()
      .map(_PostData.fromJson)
      .toList();
});

class SocialFeedScreen extends ConsumerWidget {
  const SocialFeedScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final apiPosts = ref.watch(socialPostsProvider).valueOrNull;

    final stories = <_StorySummary>[
      _StorySummary(
          'Amina',
          'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80',
          true),
      _StorySummary(
          'Mihary',
          'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80',
          true),
      _StorySummary(
          'Laza',
          'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=400&q=80',
          false),
      _StorySummary(
          'Naina',
          'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80',
          true),
      _StorySummary(
          'Tovo',
          'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80',
          false),
    ];

    final demoPosts = <_PostData>[
      _PostData(
        author: 'Mihary Market',
        handle: '@mihary.market',
        avatar:
            'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80',
        content:
            'Nouvelle récolte de vanilles de qualité premium, livrée le matin. Les clients en ligne prennent déjà les commandes.',
        image:
            'https://images.unsplash.com/photo-1518843875459-f738682238a6?auto=format&fit=crop&w=1200&q=80',
        likes: 348,
        comments: 26,
        shares: 12,
      ),
      _PostData(
        author: 'Kobato',
        handle: '@kobato',
        avatar:
            'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80',
        content:
            'Petite promo de la semaine sur les accessoires connectés. Commande rapide et paiement sécurisé via AllGo.',
        image:
            'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80',
        likes: 214,
        comments: 18,
        shares: 9,
      ),
      _PostData(
        author: 'Sahaza',
        handle: '@sahaza',
        avatar:
            'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=200&q=80',
        content:
            'Service client en ligne disponible toute la journée pour répondre aux demandes de produits personnalisés.',
        image:
            'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1200&q=80',
        likes: 421,
        comments: 41,
        shares: 18,
      ),
    ];
    final posts = apiPosts == null || apiPosts.isEmpty ? demoPosts : apiPosts;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Réseau AllGo'),
        actions: <Widget>[
          IconButton(
            onPressed: () => context.push(Routes.stories),
            icon: const Icon(Icons.auto_awesome_outlined),
            tooltip: 'Stories',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showComposer(context, ref),
        icon: const Icon(Icons.add_photo_alternate_outlined),
        label: const Text('Publier'),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(socialPostsProvider),
          child: ListView(
            padding: const EdgeInsets.all(AllGoTokens.space4),
            children: <Widget>[
              Container(
                padding: const EdgeInsets.all(AllGoTokens.space4),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
                ),
                child: Row(
                  children: <Widget>[
                    const CircleAvatar(
                      radius: 24,
                      backgroundImage: NetworkImage(
                        'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80',
                      ),
                    ),
                    const SizedBox(width: AllGoTokens.space3),
                    Expanded(
                      child: Text(
                        'Partager une nouveauté avec votre communauté ?',
                        style: theme.textTheme.titleMedium,
                      ),
                    ),
                    FilledButton.tonal(
                      onPressed: () => context.push(Routes.publish),
                      child: const Text('Créer'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AllGoTokens.space4),
              SizedBox(
                height: 104,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: stories.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(width: AllGoTokens.space2),
                  itemBuilder: (context, index) =>
                      _StoryItem(story: stories[index]),
                ),
              ),
              const SizedBox(height: AllGoTokens.space4),
              ...posts.map((post) => Padding(
                    padding: const EdgeInsets.only(bottom: AllGoTokens.space4),
                    child: _PostCard(post: post),
                  )),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showComposer(BuildContext context, WidgetRef ref) async {
    final contentController = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Nouvelle publication'),
        content: TextField(
          controller: contentController,
          autofocus: true,
          maxLines: 5,
          maxLength: 5000,
          decoration: const InputDecoration(
            hintText: 'Partagez une nouveauté avec votre communauté…',
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(contentController.text),
            child: const Text('Publier'),
          ),
        ],
      ),
    );
    contentController.dispose();
    if (result == null || result.trim().isEmpty || !context.mounted) return;

    try {
      await ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/social/posts',
        data: <String, dynamic>{'content': result.trim()},
      );
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Publication envoyée à la communauté.')),
      );
    } on DioException catch (error) {
      if (!context.mounted) return;
      final response = error.response?.data;
      final message = response is Map<String, dynamic>
          ? response['message'] as String?
          : null;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
            content: Text(message ?? 'Impossible de publier pour le moment.')),
      );
    }
  }
}

class _StoryItem extends StatelessWidget {
  const _StoryItem({required this.story});

  final _StorySummary story;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: () => context.push(Routes.stories),
      borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
      child: SizedBox(
        width: 72,
        child: Column(
          children: <Widget>[
            Container(
              padding: story.isLive ? const EdgeInsets.all(2) : EdgeInsets.zero,
              decoration: story.isLive
                  ? BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: const LinearGradient(
                        colors: [Color(0xFF22C55E), Color(0xFF0EA5E9)],
                      ),
                    )
                  : null,
              child: CircleAvatar(
                radius: 28,
                backgroundImage: NetworkImage(story.imageUrl),
              ),
            ),
            const SizedBox(height: AllGoTokens.space2),
            Text(
              story.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _PostCard extends StatelessWidget {
  const _PostCard({required this.post});

  final _PostData post;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.all(AllGoTokens.space3),
            child: Row(
              children: <Widget>[
                CircleAvatar(
                  radius: 18,
                  backgroundImage: NetworkImage(post.avatar),
                ),
                const SizedBox(width: AllGoTokens.space2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(post.author, style: theme.textTheme.titleSmall),
                      Text(post.handle,
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant)),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () {},
                  icon: const Icon(Icons.more_horiz),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space3),
            child: Text(post.content, style: theme.textTheme.bodyMedium),
          ),
          const SizedBox(height: AllGoTokens.space2),
          CachedNetworkImage(
            imageUrl: post.image,
            fit: BoxFit.cover,
            width: double.infinity,
            height: 240,
            placeholder: (_, __) => Container(
              color: theme.colorScheme.surfaceContainerHighest,
            ),
            errorWidget: (_, __, ___) => const Icon(Icons.image_not_supported),
          ),
          Padding(
            padding: const EdgeInsets.all(AllGoTokens.space3),
            child: Row(
              children: <Widget>[
                _SocialAction(
                    icon: Icons.favorite_border, label: '${post.likes}'),
                const SizedBox(width: AllGoTokens.space3),
                _SocialAction(
                    icon: Icons.chat_bubble_outline, label: '${post.comments}'),
                const SizedBox(width: AllGoTokens.space3),
                _SocialAction(
                    icon: Icons.share_outlined, label: '${post.shares}'),
                const Spacer(),
                const Icon(Icons.bookmark_border),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SocialAction extends StatelessWidget {
  const _SocialAction({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: <Widget>[
        Icon(icon, size: 18, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 4),
        Text(label,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ],
    );
  }
}

class _StorySummary {
  const _StorySummary(this.name, this.imageUrl, this.isLive);

  final String name;
  final String imageUrl;
  final bool isLive;
}

class _PostData {
  const _PostData({
    required this.author,
    required this.handle,
    required this.avatar,
    required this.content,
    required this.image,
    required this.likes,
    required this.comments,
    required this.shares,
  });

  final String author;
  final String handle;
  final String avatar;
  final String content;
  final String image;
  final int likes;
  final int comments;
  final int shares;

  factory _PostData.fromJson(Map<String, dynamic> json) {
    final author = json['author'] is Map<String, dynamic>
        ? json['author'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final media = json['media'] is List<dynamic>
        ? json['media'] as List<dynamic>
        : const <dynamic>[];
    final mediaValues = media.whereType<Map<String, dynamic>>();
    final firstMedia = mediaValues.isEmpty ? null : mediaValues.first;
    final counters = json['counters'] is Map<String, dynamic>
        ? json['counters'] as Map<String, dynamic>
        : const <String, dynamic>{};
    return _PostData(
      author: author['name'] as String? ?? 'Membre AllGo',
      handle: '',
      avatar: author['avatar'] as String? ?? '',
      content: json['content'] as String? ?? '',
      image: firstMedia?['url'] as String? ?? '',
      likes: (counters['reactions'] as num?)?.toInt() ?? 0,
      comments: (counters['comments'] as num?)?.toInt() ?? 0,
      shares: (counters['shares'] as num?)?.toInt() ?? 0,
    );
  }
}
