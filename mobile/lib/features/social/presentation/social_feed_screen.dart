import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/moderation/presentation/moderation_actions.dart';
import 'package:allgo/shared/widgets/shop_avatar.dart';
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

    // Boutiques où je détiens un rôle — le composeur propose de publier « en
    // tant que » l'une d'elles, plutôt qu'en mon nom propre par défaut sans
    // recours (§22). Le backend seul sait quel rôle autorise réellement à
    // publier pour une boutique donnée (`SocialService.resolveShopAuthor`) :
    // un choix refusé se solde par un message d'erreur, pas par un blocage
    // côté client qui dupliquerait cette règle.
    List<Map<String, dynamic>> shops = const <Map<String, dynamic>>[];
    try {
      final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>('/me/shops');
      shops = ((response.data?['data'] as List<dynamic>?) ?? const <dynamic>[])
          .whereType<Map<String, dynamic>>()
          .toList();
    } on DioException {
      // Le composeur reste utilisable en mon nom propre même si la liste des
      // boutiques n'a pas pu être chargée.
    }
    if (!context.mounted) return;

    String? selectedShopId;
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setState) => AlertDialog(
          title: const Text('Nouvelle publication'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (shops.isNotEmpty) ...<Widget>[
                DropdownButtonFormField<String?>(
                  initialValue: selectedShopId,
                  decoration: const InputDecoration(labelText: 'Publier en tant que'),
                  items: <DropdownMenuItem<String?>>[
                    const DropdownMenuItem<String?>(value: null, child: Text('Moi-même')),
                    for (final shop in shops)
                      DropdownMenuItem<String?>(
                        value: (shop['id'] ?? shop['_id']).toString(),
                        child: Text(shop['name']?.toString() ?? 'Boutique'),
                      ),
                  ],
                  onChanged: (value) => setState(() => selectedShopId = value),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                controller: contentController,
                autofocus: true,
                maxLines: 5,
                maxLength: 5000,
                decoration: const InputDecoration(
                  hintText: 'Partagez une nouveauté avec votre communauté…',
                ),
              ),
            ],
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
      ),
    );
    contentController.dispose();
    if (result == null || result.trim().isEmpty || !context.mounted) return;

    try {
      await ref.read(apiClientProvider).post<Map<String, dynamic>>(
        '/social/posts',
        data: <String, dynamic>{
          'content': result.trim(),
          if (selectedShopId != null) 'shopId': selectedShopId,
        },
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
          ? ((response['error'] as Map<String, dynamic>?)?['message'] as String?)
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

  Future<void> _reportPost() => reportViaDialog(
        context,
        ref,
        path: '/social/posts/${widget.post.id}/report',
        dialogTitle: 'Signaler cette publication',
        successMessage: 'Publication signalée à la modération.',
      );

  Future<void> _reportAuthor() {
    final post = widget.post;
    return post.authorType == 'shop' && post.shopId != null
        ? reportViaDialog(
            context,
            ref,
            path: '/moderation/shops/${post.shopId}/report',
            dialogTitle: 'Signaler ${post.author}',
            successMessage: 'Boutique signalée à la modération.',
          )
        : reportViaDialog(
            context,
            ref,
            path: '/moderation/users/${post.authorId}/report',
            dialogTitle: 'Signaler ${post.author}',
            successMessage: 'Compte signalé à la modération.',
          );
  }

  Future<void> _blockAuthor() async {
    final post = widget.post;
    final confirmed = await confirmBlockUser(context, post.author);
    if (confirmed == true && context.mounted) {
      await blockUserAccount(context, ref, post.authorId);
    }
  }

  void _openComments() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _CommentsSheet(postId: widget.post.id),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final post = widget.post;
    final myUserId = ref.watch(sessionControllerProvider).userId;
    final isMine = post.authorId.isNotEmpty && post.authorId == myUserId;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.all(AllGoTokens.space3),
            child: Row(
              children: <Widget>[
                ShopAvatar(
                  name: post.author,
                  logoUrl: post.avatar.isEmpty ? null : post.avatar,
                  size: 36,
                ),
                const SizedBox(width: AllGoTokens.space2),
                Expanded(
                  child: Text(post.author, style: theme.textTheme.titleSmall),
                ),
                PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'report_post') unawaited(_reportPost());
                    if (value == 'report_author') unawaited(_reportAuthor());
                    if (value == 'block') unawaited(_blockAuthor());
                  },
                  itemBuilder: (context) => <PopupMenuEntry<String>>[
                    const PopupMenuItem<String>(value: 'report_post', child: Text('Signaler la publication')),
                    if (!isMine) ...<PopupMenuEntry<String>>[
                      PopupMenuItem<String>(
                        value: 'report_author',
                        child: Text(post.authorType == 'shop' ? 'Signaler la boutique' : 'Signaler ce compte'),
                      ),
                      if (post.authorType != 'shop')
                        const PopupMenuItem<String>(value: 'block', child: Text('Bloquer ce compte')),
                    ],
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
                  onTap: _openComments,
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

class _CommentData {
  const _CommentData({required this.id, required this.author, required this.content});

  final String id;
  final String author;
  final String content;

  factory _CommentData.fromJson(Map<String, dynamic> json) {
    final author = json['author'] is Map<String, dynamic>
        ? json['author'] as Map<String, dynamic>
        : const <String, dynamic>{};
    return _CommentData(
      id: idFromJson(json),
      author: author['name'] as String? ?? 'Membre AllGo',
      content: json['content'] as String? ?? '',
    );
  }
}

final _commentsProvider = FutureProvider.autoDispose.family<List<_CommentData>, String>((ref, postId) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/social/posts/$postId/comments');
  final items = (response.data?['data'] as List<dynamic>?) ?? const <dynamic>[];
  return items.whereType<Map<String, dynamic>>().map(_CommentData.fromJson).toList();
});

/// Feuille de commentaires — lecture, ajout et signalement (§29). Avant cet
/// écran, seul le compteur de commentaires était visible : aucune route
/// mobile ne permettait de les lire ni d'en signaler un.
class _CommentsSheet extends ConsumerStatefulWidget {
  const _CommentsSheet({required this.postId});

  final String postId;

  @override
  ConsumerState<_CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends ConsumerState<_CommentsSheet> {
  final _controller = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final content = _controller.text.trim();
    if (content.isEmpty || _sending) return;
    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).post<void>(
        '/social/posts/${widget.postId}/comments',
        data: <String, String>{'content': content},
      );
      _controller.clear();
      ref.invalidate(_commentsProvider(widget.postId));
    } on DioException {
      messenger.showSnackBar(const SnackBar(content: Text('Impossible d’envoyer ce commentaire.')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _reportComment(String commentId) => reportViaDialog(
        context,
        ref,
        path: '/social/comments/$commentId/report',
        dialogTitle: 'Signaler ce commentaire',
        successMessage: 'Commentaire signalé à la modération.',
      );

  @override
  Widget build(BuildContext context) {
    final comments = ref.watch(_commentsProvider(widget.postId));

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.7,
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
              child: Text('Commentaires', style: Theme.of(context).textTheme.titleMedium),
            ),
            const SizedBox(height: AllGoTokens.space2),
            Expanded(
              child: comments.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (_, __) => const Center(child: Text('Commentaires indisponibles hors ligne.')),
                data: (items) => items.isEmpty
                    ? const Center(child: Text('Aucun commentaire pour l’instant.'))
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                        itemCount: items.length,
                        itemBuilder: (context, index) {
                          final comment = items[index];
                          return ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(comment.author, style: Theme.of(context).textTheme.titleSmall),
                            subtitle: Text(comment.content),
                            trailing: IconButton(
                              icon: const Icon(Icons.flag_outlined, size: 18),
                              tooltip: 'Signaler',
                              onPressed: () => _reportComment(comment.id),
                            ),
                          );
                        },
                      ),
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.all(AllGoTokens.space3),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        maxLength: 2000,
                        decoration: const InputDecoration(
                          hintText: 'Ajouter un commentaire…',
                          counterText: '',
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: _sending ? null : _send,
                      icon: const Icon(Icons.send),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PostData {
  const _PostData({
    required this.id,
    required this.authorId,
    required this.authorType,
    required this.shopId,
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
  /// Compte à l'origine de la publication — la cible d'un signalement ou d'un
  /// blocage « utilisateur », que l'auteur affiché soit son propre nom ou
  /// celui d'une boutique qu'il gère (§29).
  final String authorId;
  final String authorType;
  final String? shopId;
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
      authorId: json['authorId']?.toString() ?? '',
      authorType: author['type'] as String? ?? 'user',
      shopId: author['shopId']?.toString() ?? json['shopId']?.toString(),
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
