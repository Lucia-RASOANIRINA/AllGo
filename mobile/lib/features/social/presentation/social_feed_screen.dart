import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:share_plus/share_plus.dart';

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
    final posts = ref.watch(socialPostsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Réseau AllGo'),
        actions: <Widget>[
          IconButton(
            onPressed: () => _createStory(context, ref),
            icon: const Icon(Icons.add_circle_outline),
            tooltip: 'Créer une story',
          ),
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
          child: posts.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) => ListView(
              children: const <Widget>[
                Padding(
                  padding: EdgeInsets.all(AllGoTokens.space8),
                  child: Center(child: Text('Fil indisponible hors ligne.')),
                ),
              ],
            ),
            data: (list) => list.isEmpty
                ? ListView(
                    padding: const EdgeInsets.all(AllGoTokens.space4),
                    children: <Widget>[
                      _Composer(onTap: () => _showComposer(context, ref)),
                      const SizedBox(height: AllGoTokens.space8),
                      const Center(
                        child: Text('Aucune publication pour l’instant. Soyez le premier.'),
                      ),
                    ],
                  )
                : ListView(
                    padding: const EdgeInsets.all(AllGoTokens.space4),
                    children: <Widget>[
                      _Composer(onTap: () => _showComposer(context, ref)),
                      const SizedBox(height: AllGoTokens.space4),
                      ...list.map(
                        (post) => Padding(
                          padding: const EdgeInsets.only(bottom: AllGoTokens.space4),
                          child: _PostCard(post: post),
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }

  Future<void> _createStory(BuildContext context, WidgetRef ref) async {
    final image = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 82);
    if (image == null || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await image.readAsBytes();
      final api = ref.read(apiClientProvider);
      final upload = await api.post<Map<String, dynamic>>(
        '/media/upload-url',
        data: <String, dynamic>{'type': 'image/jpeg', 'size': bytes.length},
      );
      final data = upload.data?['data'];
      if (data is! Map<String, dynamic>) throw const FormatException('Réponse média invalide.');
      await api.put<void>(
        data['uploadUrl'] as String,
        data: bytes,
        options: Options(
          headers: <String, dynamic>{'Content-Type': 'image/jpeg', 'Content-Length': bytes.length},
        ),
      );
      await api.post<void>(
        '/social/stories',
        data: <String, String>{'key': data['key'] as String, 'type': 'image'},
      );
      messenger.showSnackBar(const SnackBar(content: Text('Story publiée pour 24 heures.')));
    } on DioException catch (error) {
      final response = error.response?.data;
      final message = response is Map<String, dynamic> ? response['message'] as String? : null;
      messenger.showSnackBar(SnackBar(content: Text(message ?? 'Impossible de publier la story.')));
    }
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
      ref.invalidate(socialPostsProvider);
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

class _Composer extends StatelessWidget {
  const _Composer({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(AllGoTokens.space4),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
      ),
      child: Row(
        children: <Widget>[
          const CircleAvatar(radius: 24, child: Icon(Icons.person_outline)),
          const SizedBox(width: AllGoTokens.space3),
          Expanded(
            child: Text(
              'Partager une nouveauté avec votre communauté ?',
              style: theme.textTheme.titleMedium,
            ),
          ),
          // Le thème impose une largeur minimale infinie aux `FilledButton`
          // (pour les CTA pleine largeur des formulaires) — sans cette
          // annulation locale, ce bouton posé dans un `Row` sans `Expanded`
          // demande une largeur infinie et fait planter la mise en page.
          FilledButton.tonal(
            style: FilledButton.styleFrom(minimumSize: Size.zero),
            onPressed: onTap,
            child: const Text('Créer'),
          ),
        ],
      ),
    );
  }
}

class _PostCard extends ConsumerStatefulWidget {
  const _PostCard({required this.post});

  final _PostData post;

  @override
  ConsumerState<_PostCard> createState() => _PostCardState();
}

class _PostCardState extends ConsumerState<_PostCard> {
  late bool _liked = widget.post.reactedLocally;
  late int _likes = widget.post.likes;
  late int _shares = widget.post.shares;
  bool _saved = false;

  Future<void> _toggleLike() async {
    setState(() {
      _liked = !_liked;
      _likes += _liked ? 1 : -1;
    });
    try {
      await ref.read(apiClientProvider).post<void>('/social/posts/${widget.post.id}/reactions');
    } on DioException {
      if (mounted) {
        setState(() {
          _liked = !_liked;
          _likes += _liked ? 1 : -1;
        });
      }
    }
  }

  Future<void> _share() async {
    setState(() => _shares += 1);
    try {
      await ref.read(apiClientProvider).post<void>('/social/posts/${widget.post.id}/share');
      await Share.share('${widget.post.author} sur AllGo : ${widget.post.content}');
    } on DioException {
      if (mounted) setState(() => _shares -= 1);
    }
  }

  Future<void> _toggleSave() async {
    final messenger = ScaffoldMessenger.of(context);
    final wasSaved = _saved;
    setState(() => _saved = !_saved);
    try {
      final api = ref.read(apiClientProvider);
      if (wasSaved) {
        await api.delete<void>(
          '/me/favorites/${widget.post.id}',
          queryParameters: <String, String>{'type': 'post'},
        );
      } else {
        await api.post<void>(
          '/me/favorites',
          data: <String, String>{'targetType': 'post', 'targetId': widget.post.id},
        );
      }
    } on DioException {
      if (mounted) setState(() => _saved = wasSaved);
      messenger.showSnackBar(const SnackBar(content: Text('Action impossible. Réessayez.')));
    }
  }

  Future<void> _report() async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).post<void>('/social/posts/${widget.post.id}/report');
      messenger.showSnackBar(const SnackBar(content: Text('Publication signalée à la modération.')));
    } on DioException {
      messenger.showSnackBar(const SnackBar(content: Text('Impossible de signaler cette publication.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final post = widget.post;

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
                  backgroundImage: post.avatar.isEmpty ? null : CachedNetworkImageProvider(post.avatar),
                  child: post.avatar.isEmpty ? const Icon(Icons.storefront_outlined) : null,
                ),
                const SizedBox(width: AllGoTokens.space2),
                Expanded(
                  child: Text(post.author, style: theme.textTheme.titleSmall),
                ),
                PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'report') unawaited(_report());
                  },
                  itemBuilder: (context) => const <PopupMenuEntry<String>>[
                    PopupMenuItem<String>(value: 'report', child: Text('Signaler')),
                  ],
                ),
              ],
            ),
          ),
          if (post.content.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space3),
              child: Text(post.content, style: theme.textTheme.bodyMedium),
            ),
          if (post.image.isNotEmpty) ...<Widget>[
            const SizedBox(height: AllGoTokens.space2),
            CachedNetworkImage(
              imageUrl: post.image,
              fit: BoxFit.cover,
              width: double.infinity,
              height: 240,
              placeholder: (_, __) => Container(color: theme.colorScheme.surfaceContainerHighest),
              errorWidget: (_, __, ___) => const Icon(Icons.image_not_supported),
            ),
          ],
          Padding(
            padding: const EdgeInsets.all(AllGoTokens.space3),
            child: Row(
              children: <Widget>[
                _SocialAction(
                  icon: _liked ? Icons.favorite : Icons.favorite_border,
                  label: '$_likes',
                  color: _liked ? theme.colorScheme.error : null,
                  onTap: _toggleLike,
                ),
                const SizedBox(width: AllGoTokens.space3),
                _SocialAction(
                  icon: Icons.chat_bubble_outline,
                  label: '${post.comments}',
                ),
                const SizedBox(width: AllGoTokens.space3),
                _SocialAction(icon: Icons.share_outlined, label: '$_shares', onTap: _share),
                const Spacer(),
                IconButton(
                  onPressed: _toggleSave,
                  icon: Icon(_saved ? Icons.bookmark : Icons.bookmark_border),
                  tooltip: 'Enregistrer',
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SocialAction extends StatelessWidget {
  const _SocialAction({required this.icon, required this.label, this.color, this.onTap});

  final IconData icon;
  final String label;
  final Color? color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final effectiveColor = color ?? theme.colorScheme.onSurfaceVariant;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
      child: Row(
        children: <Widget>[
          Icon(icon, size: 18, color: effectiveColor),
          const SizedBox(width: 4),
          Text(label, style: theme.textTheme.bodySmall?.copyWith(color: effectiveColor)),
        ],
      ),
    );
  }
}

class _PostData {
  const _PostData({
    required this.id,
    required this.author,
    required this.avatar,
    required this.content,
    required this.image,
    required this.likes,
    required this.comments,
    required this.shares,
    required this.reactedLocally,
  });

  final String id;
  final String author;
  final String avatar;
  final String content;
  final String image;
  final int likes;
  final int comments;
  final int shares;
  final bool reactedLocally;

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
      id: idFromJson(json),
      author: author['name'] as String? ?? 'Membre AllGo',
      avatar: author['avatar'] as String? ?? '',
      content: json['content'] as String? ?? '',
      image: firstMedia?['url'] as String? ?? '',
      likes: (counters['reactions'] as num?)?.toInt() ?? 0,
      comments: (counters['comments'] as num?)?.toInt() ?? 0,
      shares: (counters['shares'] as num?)?.toInt() ?? 0,
      // Aucune route ne renvoie l'historique de mes réactions passées (même
      // décision de portée que `ShopPostsController`) : vrai seulement si
      // j'ai réagi PENDANT cette session.
      reactedLocally: false,
    );
  }
}
