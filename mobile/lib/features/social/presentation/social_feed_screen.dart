import 'dart:async';
import 'dart:io';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/core/network/json_parsing.dart';
import 'package:allgo/features/auth/presentation/session_controller.dart';
import 'package:allgo/features/messaging/presentation/messaging_providers.dart';
import 'package:allgo/features/moderation/presentation/moderation_actions.dart';
import 'package:allgo/shared/widgets/shimmer.dart';
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

/// Choix caméra/galerie — même déroulé qu'un réseau social grand public :
/// jamais uniquement la galerie, toujours la possibilité de prendre la photo
/// sur l'instant (stories, publications, avatar).
Future<ImageSource?> _chooseImageSource(BuildContext context) {
  return showModalBottomSheet<ImageSource>(
    context: context,
    showDragHandle: true,
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined),
            title: const Text('Prendre une photo'),
            onTap: () => Navigator.pop(context, ImageSource.camera),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined),
            title: const Text('Choisir depuis la galerie'),
            onTap: () => Navigator.pop(context, ImageSource.gallery),
          ),
          const SizedBox(height: 16),
        ],
      ),
    ),
  );
}

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
            loading: () => const FeedPostSkeletonList(),
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
                      _Composer(
                        onTap: () => _showComposer(context, ref),
                        onPickPhoto: () => _showComposer(context, ref, pickImageOnOpen: true),
                        onCreateStory: () => _createStory(context, ref),
                      ),
                      const SizedBox(height: AllGoTokens.space8),
                      const Center(
                        child: Text('Aucune publication pour l’instant. Soyez le premier.'),
                      ),
                    ],
                  )
                : ListView(
                    padding: const EdgeInsets.all(AllGoTokens.space4),
                    children: <Widget>[
                      _Composer(
                        onTap: () => _showComposer(context, ref),
                        onPickPhoto: () => _showComposer(context, ref, pickImageOnOpen: true),
                        onCreateStory: () => _createStory(context, ref),
                      ),
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
    final source = await _chooseImageSource(context);
    if (source == null || !context.mounted) return;
    final image = await ImagePicker().pickImage(source: source, imageQuality: 82);
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

  Future<void> _showComposer(
    BuildContext context,
    WidgetRef ref, {
    bool pickImageOnOpen = false,
    _PostData? editingPost,
  }) async {
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

    final published = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _ComposerDialog(
        shops: shops,
        pickImageOnOpen: pickImageOnOpen,
        editingPost: editingPost,
      ),
    );
    if (published == true) ref.invalidate(socialPostsProvider);
  }
}

/// Composeur de publication — texte, boutique « en tant que » et,
/// désormais, une image : jusqu'ici le seul moyen mobile de publier une
/// image passait par une story (24 h, pas de légende), alors que le site web
/// permet d'en joindre une à une publication normale (§22, persistante,
/// commentable). `CreatePostDto` acceptait déjà `media` côté serveur — rien
/// ne l'exposait côté mobile.
class _ComposerDialog extends ConsumerStatefulWidget {
  const _ComposerDialog({required this.shops, this.pickImageOnOpen = false, this.editingPost});

  final List<Map<String, dynamic>> shops;

  /// Ouvre directement le sélecteur d'image — pour le bouton « Photo » du
  /// composeur en un tap, comme sur Facebook, plutôt que de forcer un
  /// deuxième geste une fois la boîte de dialogue déjà ouverte.
  final bool pickImageOnOpen;

  /// Non nul en mode édition — pré-remplit le contenu/l'image existante et
  /// bascule `_publish()` sur `PUT` au lieu de `POST`.
  final _PostData? editingPost;

  @override
  ConsumerState<_ComposerDialog> createState() => _ComposerDialogState();
}

class _ComposerDialogState extends ConsumerState<_ComposerDialog> {
  final _contentController = TextEditingController();
  String? _selectedShopId;
  XFile? _image;
  String? _existingImageUrl;
  bool _publishing = false;

  bool get _isEditing => widget.editingPost != null;

  @override
  void initState() {
    super.initState();
    final editing = widget.editingPost;
    if (editing != null) {
      _contentController.text = editing.content;
      _existingImageUrl = editing.image.isEmpty ? null : editing.image;
    }
    if (widget.pickImageOnOpen) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _pickImage());
    }
  }

  @override
  void dispose() {
    _contentController.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final source = await _chooseImageSource(context);
    if (source == null || !mounted) return;
    final image = await ImagePicker().pickImage(source: source, imageQuality: 82);
    if (image != null && mounted) setState(() => _image = image);
  }

  /// Même déroulé en deux temps que `_createStory` (`upload-url` puis `PUT`
  /// des octets), mais l'URL publique renvoyée directement par le serveur
  /// évite de reconstruire le schéma `_200/_800/_1600.webp` ici — un détail
  /// d'implémentation du stockage média, pas une règle que le client devrait
  /// connaître.
  Future<Map<String, dynamic>> _uploadImage() async {
    final bytes = await _image!.readAsBytes();
    final api = ref.read(apiClientProvider);
    final upload = await api.post<Map<String, dynamic>>(
      '/media/upload-url',
      data: <String, dynamic>{'type': 'image/jpeg', 'size': bytes.length},
    );
    final ticket = upload.data?['data'];
    if (ticket is! Map<String, dynamic>) {
      throw const FormatException('Réponse média invalide.');
    }
    // Le jeton de l'URL de dépôt est à usage unique (§ `MediaService`) : un
    // seul `PUT`, dont la réponse porte déjà l'URL publique.
    final received = await api.put<Map<String, dynamic>>(
      ticket['uploadUrl'] as String,
      data: bytes,
      options: Options(
        headers: <String, dynamic>{'Content-Type': 'image/jpeg', 'Content-Length': bytes.length},
      ),
    );
    return (received.data?['data'] as Map<String, dynamic>?) ?? const <String, dynamic>{};
  }

  Future<void> _publish() async {
    final content = _contentController.text.trim();
    if (content.isEmpty && _image == null && _existingImageUrl == null) return;

    setState(() => _publishing = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      Map<String, dynamic>? uploaded;
      if (_image != null) uploaded = await _uploadImage();

      final mediaField = uploaded != null
          // `CreatePostDto.media[].url` est en réalité stocké tel quel comme
          // clé interne (`file_path`) — jamais une URL complète.
          // `SocialService.toJson()` reconstruit thumbUrl/previewUrl/url à la
          // lecture à partir de cette seule clé (`MediaService.publicUrls`) ;
          // les renvoyer ici double le préfixe du domaine (constaté en
          // direct : une URL imbriquée dans elle-même).
          ? <Map<String, dynamic>>[
              <String, dynamic>{'url': uploaded['key'], 'type': 'image'},
            ]
          // Édition, image existante retirée sans nouvelle image choisie :
          // un tableau vide efface le média côté serveur (`update()` ne
          // touche `post_media` que si `media` est fourni).
          : (_isEditing && _existingImageUrl == null)
              ? const <Map<String, dynamic>>[]
              : null;

      final api = ref.read(apiClientProvider);
      final body = <String, dynamic>{
        if (content.isNotEmpty) 'content': content,
        if (_selectedShopId != null) 'shopId': _selectedShopId,
        if (mediaField != null) 'media': mediaField,
      };
      if (_isEditing) {
        await api.put<Map<String, dynamic>>('/social/posts/${widget.editingPost!.id}', data: body);
      } else {
        await api.post<Map<String, dynamic>>('/social/posts', data: body);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
      messenger.showSnackBar(
        SnackBar(content: Text(_isEditing ? 'Publication modifiée.' : 'Publication envoyée à la communauté.')),
      );
    } on DioException catch (error) {
      final response = error.response?.data;
      final message = response is Map<String, dynamic>
          ? ((response['error'] as Map<String, dynamic>?)?['message'] as String?)
          : null;
      messenger.showSnackBar(
        SnackBar(content: Text(message ?? 'Impossible de publier pour le moment.')),
      );
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canPublish = !_publishing &&
        (_contentController.text.trim().isNotEmpty || _image != null || _existingImageUrl != null);

    return AlertDialog(
      title: Text(_isEditing ? 'Modifier la publication' : 'Nouvelle publication'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (widget.shops.isNotEmpty) ...<Widget>[
            DropdownButtonFormField<String?>(
              initialValue: _selectedShopId,
              decoration: const InputDecoration(labelText: 'Publier en tant que'),
              items: <DropdownMenuItem<String?>>[
                const DropdownMenuItem<String?>(value: null, child: Text('Moi-même')),
                for (final shop in widget.shops)
                  DropdownMenuItem<String?>(
                    value: (shop['id'] ?? shop['_id']).toString(),
                    child: Text(shop['name']?.toString() ?? 'Boutique'),
                  ),
              ],
              onChanged: _publishing ? null : (value) => setState(() => _selectedShopId = value),
            ),
            const SizedBox(height: 12),
          ],
          TextField(
            controller: _contentController,
            autofocus: true,
            maxLines: 5,
            maxLength: 5000,
            enabled: !_publishing,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              hintText: 'Partagez une nouveauté avec votre communauté…',
            ),
          ),
          if (_image != null || _existingImageUrl != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Stack(
                children: <Widget>[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: _image != null
                        ? Image.file(
                            File(_image!.path),
                            height: 160,
                            width: double.infinity,
                            fit: BoxFit.cover,
                          )
                        : CachedNetworkImage(
                            imageUrl: _existingImageUrl!,
                            height: 160,
                            width: double.infinity,
                            fit: BoxFit.cover,
                          ),
                  ),
                  Positioned(
                    top: 4,
                    right: 4,
                    child: Material(
                      color: Colors.black54,
                      shape: const CircleBorder(),
                      child: IconButton(
                        onPressed: _publishing
                            ? null
                            : () => setState(() {
                                  _image = null;
                                  _existingImageUrl = null;
                                }),
                        icon: const Icon(Icons.close, color: Colors.white, size: 18),
                        tooltip: 'Retirer l’image',
                      ),
                    ),
                  ),
                ],
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: OutlinedButton.icon(
                onPressed: _publishing ? null : _pickImage,
                icon: const Icon(Icons.image_outlined),
                label: const Text('Ajouter une image'),
              ),
            ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _publishing ? null : () => Navigator.of(context).pop(),
          child: const Text('Annuler'),
        ),
        FilledButton(
          onPressed: canPublish ? _publish : null,
          child: _publishing
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(_isEditing ? 'Enregistrer' : 'Publier'),
        ),
      ],
    );
  }
}

/// Point d'entrée du composeur — à la Facebook : avatar + champ « Quoi de
/// neuf ? » en pilule, puis une rangée d'actions rapides (Photo, Story) sous
/// une fine séparation, plutôt qu'une simple bannière pleine couleur.
class _Composer extends ConsumerWidget {
  const _Composer({required this.onTap, required this.onPickPhoto, required this.onCreateStory});

  final VoidCallback onTap;
  final VoidCallback onPickPhoto;
  final VoidCallback onCreateStory;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final name = ref.watch(sessionControllerProvider).displayName ?? 'Moi';
    final firstName = name.trim().isEmpty ? 'vous' : name.trim().split(' ').first;

    return Container(
      padding: const EdgeInsets.all(AllGoTokens.space3),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(AllGoTokens.radiusCard),
        border: Border.all(color: theme.colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              ShopAvatar(name: name, size: 40),
              const SizedBox(width: AllGoTokens.space3),
              Expanded(
                child: InkWell(
                  onTap: onTap,
                  borderRadius: BorderRadius.circular(AllGoTokens.radiusPill),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(AllGoTokens.radiusPill),
                    ),
                    child: Text(
                      'Quoi de neuf, $firstName ?',
                      style: theme.textTheme.bodyMedium
                          ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: AllGoTokens.space2),
            child: Divider(height: 1),
          ),
          Row(
            children: <Widget>[
              Expanded(
                child: TextButton.icon(
                  onPressed: onPickPhoto,
                  icon: Icon(Icons.image_outlined, color: theme.colorScheme.tertiary),
                  label: const Text('Photo'),
                ),
              ),
              SizedBox(
                height: 20,
                child: VerticalDivider(width: 1, color: theme.colorScheme.outlineVariant),
              ),
              Expanded(
                child: TextButton.icon(
                  onPressed: onCreateStory,
                  icon: Icon(Icons.auto_awesome_outlined, color: theme.colorScheme.secondary),
                  label: const Text('Story'),
                ),
              ),
            ],
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
  late int _comments = widget.post.comments;
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

  Future<void> _editPost() async {
    final published = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => _ComposerDialog(
        shops: const <Map<String, dynamic>>[],
        editingPost: widget.post,
      ),
    );
    if (published == true) ref.invalidate(socialPostsProvider);
  }

  Future<void> _deletePost() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Supprimer cette publication ?'),
        content: const Text('Cette action est irréversible.'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Supprimer'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).delete<void>('/social/posts/${widget.post.id}');
      ref.invalidate(socialPostsProvider);
    } on DioException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Suppression impossible. Réessayez.')),
      );
    }
  }

  Future<void> _messageAuthor() async {
    final post = widget.post;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final conversationId =
          await startConversationWithUser(ref, post.authorId);
      if (mounted) {
        context.push(Routes.messagePath(conversationId), extra: post.author);
      }
    } on DioException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Impossible d’ouvrir la conversation.')),
      );
    }
  }

  void _openComments() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _CommentsSheet(
        postId: widget.post.id,
        onCountDelta: (delta) => setState(() => _comments += delta),
      ),
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
                    if (value == 'message') unawaited(_messageAuthor());
                    if (value == 'edit_post') unawaited(_editPost());
                    if (value == 'delete_post') unawaited(_deletePost());
                  },
                  itemBuilder: (context) => isMine
                      ? const <PopupMenuEntry<String>>[
                          PopupMenuItem<String>(value: 'edit_post', child: Text('Modifier')),
                          PopupMenuItem<String>(value: 'delete_post', child: Text('Supprimer')),
                        ]
                      : <PopupMenuEntry<String>>[
                          const PopupMenuItem<String>(value: 'report_post', child: Text('Signaler la publication')),
                          // Espace MP à la Messenger : n'importe quel client
                          // peut écrire à l'auteur, pas seulement à une boutique.
                          const PopupMenuItem<String>(value: 'message', child: Text('Envoyer un message')),
                          PopupMenuItem<String>(
                            value: 'report_author',
                            child: Text(post.authorType == 'shop' ? 'Signaler la boutique' : 'Signaler ce compte'),
                          ),
                          if (post.authorType != 'shop')
                            const PopupMenuItem<String>(value: 'block', child: Text('Bloquer ce compte')),
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
                  label: '$_comments',
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
  const _CommentData({
    required this.id,
    required this.userId,
    required this.author,
    required this.content,
    this.parentId,
  });

  final String id;
  final String userId;
  final String author;
  final String content;

  /// Non nul pour une réponse à un autre commentaire — colonne `parent_id`
  /// déjà présente en base (partagée avec le site web) mais jamais exposée
  /// jusqu'ici : les fils de discussion n'existaient pas côté mobile.
  final String? parentId;

  factory _CommentData.fromJson(Map<String, dynamic> json) {
    final author = json['author'] is Map<String, dynamic>
        ? json['author'] as Map<String, dynamic>
        : const <String, dynamic>{};
    return _CommentData(
      id: idFromJson(json),
      userId: json['userId']?.toString() ?? '',
      author: author['name'] as String? ?? 'Membre AllGo',
      content: json['content'] as String? ?? '',
      parentId: json['parentId']?.toString(),
    );
  }
}

final _commentsProvider = FutureProvider.autoDispose.family<List<_CommentData>, String>((ref, postId) async {
  final response = await ref.watch(apiClientProvider).get<Map<String, dynamic>>('/social/posts/$postId/comments');
  final items = (response.data?['data'] as List<dynamic>?) ?? const <dynamic>[];
  return items.whereType<Map<String, dynamic>>().map(_CommentData.fromJson).toList();
});

/// Feuille de commentaires — lecture, ajout, modification, suppression et
/// signalement (§29). Avant cet écran, seul le compteur de commentaires était
/// visible : aucune route mobile ne permettait de les lire ni d'en signaler
/// un ; modifier/supprimer son propre commentaire n'existait pas du tout.
class _CommentsSheet extends ConsumerStatefulWidget {
  const _CommentsSheet({required this.postId, required this.onCountDelta});

  final String postId;

  /// Notifie la carte de publication d'un ajout (+1) ou d'une suppression
  /// (-1) — le compteur affiché sous la publication vient de son propre état
  /// local (comme les « J'aime »), il ne se recalcule pas tout seul.
  final ValueChanged<int> onCountDelta;

  @override
  ConsumerState<_CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends ConsumerState<_CommentsSheet> {
  final _controller = TextEditingController();
  bool _sending = false;

  /// Commentaire auquel la prochaine saisie répond — `null` pour un
  /// commentaire de premier niveau, comme sur Facebook.
  _CommentData? _replyTo;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _startReply(_CommentData comment) {
    setState(() => _replyTo = comment);
  }

  Future<void> _send() async {
    final content = _controller.text.trim();
    if (content.isEmpty || _sending) return;
    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    final replyTo = _replyTo;
    try {
      await ref.read(apiClientProvider).post<void>(
        '/social/posts/${widget.postId}/comments',
        data: <String, String>{
          'content': content,
          if (replyTo != null) 'parentId': replyTo.id,
        },
      );
      _controller.clear();
      if (mounted) setState(() => _replyTo = null);
      ref.invalidate(_commentsProvider(widget.postId));
      widget.onCountDelta(1);
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

  Future<void> _editComment(_CommentData comment) async {
    final controller = TextEditingController(text: comment.content);
    final newContent = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Modifier le commentaire'),
        content: TextField(controller: controller, autofocus: true, minLines: 1, maxLines: 4),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Enregistrer'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (newContent == null || newContent.isEmpty || newContent == comment.content) return;
    if (!mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).patch<void>(
        '/social/comments/${comment.id}',
        data: <String, String>{'content': newContent},
      );
      ref.invalidate(_commentsProvider(widget.postId));
    } on DioException {
      messenger.showSnackBar(const SnackBar(content: Text('Modification impossible. Réessayez.')));
    }
  }

  Future<void> _deleteComment(String commentId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Supprimer ce commentaire ?'),
        content: const Text('Cette action est irréversible.'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Supprimer'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiClientProvider).delete<void>('/social/comments/$commentId');
      ref.invalidate(_commentsProvider(widget.postId));
      widget.onCountDelta(-1);
    } on DioException {
      messenger.showSnackBar(const SnackBar(content: Text('Suppression impossible. Réessayez.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final comments = ref.watch(_commentsProvider(widget.postId));
    final myUserId = ref.watch(sessionControllerProvider).userId;

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
                loading: () => const AvatarLineSkeletonList(itemCount: 4),
                error: (_, __) => const Center(child: Text('Commentaires indisponibles hors ligne.')),
                data: (items) {
                  if (items.isEmpty) {
                    return const Center(child: Text('Aucun commentaire pour l’instant.'));
                  }
                  // Fil de discussion à plat en base (`parent_id`) — regroupé
                  // ici en commentaires de premier niveau suivis de leurs
                  // réponses, comme sur Facebook.
                  final topLevel = items.where((c) => c.parentId == null).toList();
                  final repliesByParent = <String, List<_CommentData>>{};
                  for (final comment in items) {
                    if (comment.parentId == null) continue;
                    (repliesByParent[comment.parentId!] ??= <_CommentData>[]).add(comment);
                  }

                  return ListView(
                    padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                    children: <Widget>[
                      for (final comment in topLevel) ...<Widget>[
                        _CommentTile(
                          comment: comment,
                          isMine: comment.userId.isNotEmpty && comment.userId == myUserId,
                          onEdit: () => unawaited(_editComment(comment)),
                          onDelete: () => unawaited(_deleteComment(comment.id)),
                          onReport: () => unawaited(_reportComment(comment.id)),
                          onReply: () => _startReply(comment),
                        ),
                        for (final reply in repliesByParent[comment.id] ?? const <_CommentData>[])
                          Padding(
                            padding: const EdgeInsets.only(left: AllGoTokens.space6),
                            child: _CommentTile(
                              comment: reply,
                              isMine: reply.userId.isNotEmpty && reply.userId == myUserId,
                              onEdit: () => unawaited(_editComment(reply)),
                              onDelete: () => unawaited(_deleteComment(reply.id)),
                              onReport: () => unawaited(_reportComment(reply.id)),
                              onReply: () => _startReply(comment),
                            ),
                          ),
                      ],
                    ],
                  );
                },
              ),
            ),
            if (_replyTo != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        'Réponse à ${_replyTo!.author}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    IconButton(
                      onPressed: () => setState(() => _replyTo = null),
                      icon: const Icon(Icons.close, size: 16),
                      tooltip: 'Annuler la réponse',
                    ),
                  ],
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
                        decoration: InputDecoration(
                          hintText: _replyTo == null ? 'Ajouter un commentaire…' : 'Répondre…',
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

/// Une ligne de commentaire ou de réponse — extrait de `_CommentsSheet` pour
/// être réutilisé identiquement aux deux niveaux du fil de discussion.
class _CommentTile extends StatelessWidget {
  const _CommentTile({
    required this.comment,
    required this.isMine,
    required this.onEdit,
    required this.onDelete,
    required this.onReport,
    required this.onReply,
  });

  final _CommentData comment;
  final bool isMine;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onReport;
  final VoidCallback onReply;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(isMine ? 'Vous' : comment.author, style: Theme.of(context).textTheme.titleSmall),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(comment.content),
          TextButton(
            onPressed: onReply,
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Répondre'),
          ),
        ],
      ),
      trailing: PopupMenuButton<String>(
        icon: const Icon(Icons.more_vert, size: 18),
        onSelected: (value) {
          if (value == 'edit') onEdit();
          if (value == 'delete') onDelete();
          if (value == 'report') onReport();
        },
        itemBuilder: (context) => isMine
            ? const <PopupMenuEntry<String>>[
                PopupMenuItem<String>(value: 'edit', child: Text('Modifier')),
                PopupMenuItem<String>(value: 'delete', child: Text('Supprimer')),
              ]
            : const <PopupMenuEntry<String>>[
                PopupMenuItem<String>(value: 'report', child: Text('Signaler')),
              ],
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
      reactedLocally: json['reactedByMe'] as bool? ?? false,
    );
  }
}

final _singlePostProvider =
    FutureProvider.autoDispose.family<_PostData?, String>((ref, id) async {
  try {
    final response = await ref
        .watch(apiClientProvider)
        .get<Map<String, dynamic>>('/social/posts/$id');
    final data = response.data?['data'];
    return data is Map<String, dynamic> ? _PostData.fromJson(data) : null;
  } on DioException catch (error) {
    if (error.response?.statusCode == 404) return null;
    rethrow;
  }
});

/// Ouvre une publication précise — point d'atterrissage d'une notification
/// « j'adore »/« commentaire », comme sur Facebook, plutôt que de renvoyer
/// vers le fil général où il faut la retrouver soi-même.
class PostDetailScreen extends ConsumerWidget {
  const PostDetailScreen({required this.postId, super.key});

  final String postId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final post = ref.watch(_singlePostProvider(postId));
    return Scaffold(
      appBar: AppBar(title: const Text('Publication')),
      body: post.when(
        loading: () => const FeedPostSkeletonList(),
        error: (_, __) => const Center(child: Text('Publication indisponible hors ligne.')),
        data: (data) => data == null
            ? const Center(child: Text('Cette publication n’existe plus.'))
            : SingleChildScrollView(
                padding: const EdgeInsets.all(AllGoTokens.space4),
                child: _PostCard(post: data),
              ),
      ),
    );
  }
}
