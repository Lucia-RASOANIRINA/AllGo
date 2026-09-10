import 'dart:async';

import 'package:allgo/app/router.dart';
import 'package:allgo/app/theme.dart';
import 'package:allgo/core/network/api_client.dart';
import 'package:allgo/features/messaging/presentation/messaging_providers.dart';
import 'package:allgo/features/shops/domain/shop_summary.dart';
import 'package:allgo/features/shops/presentation/shops_providers.dart';
import 'package:allgo/shared/widgets/async_view.dart';
import 'package:allgo/shared/widgets/shimmer.dart';
import 'package:allgo/shared/widgets/shop_avatar.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

/// Liste de mes conversations — `GET /me/conversations`, avec un second
/// onglet pour les conversations archivées (§ archivage par participant).
class MessagesListScreen extends ConsumerWidget {
  const MessagesListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Messages'),
          bottom: const TabBar(
            tabs: <Widget>[
              Tab(text: 'Boîte de réception'),
              Tab(text: 'Archivées'),
            ],
          ),
        ),
        body: const TabBarView(
          children: <Widget>[
            _ConversationList(archived: false),
            _ConversationList(archived: true),
          ],
        ),
        // Jusqu'ici, une conversation ne pouvait naître que depuis une fiche
        // boutique : impossible d'en démarrer une nouvelle depuis l'espace
        // messages lui-même, alors que c'est le point d'entrée naturel.
        floatingActionButton: FloatingActionButton(
          onPressed: () => _startNewConversation(context, ref),
          tooltip: 'Nouvelle conversation',
          child: const Icon(Icons.add_comment_outlined),
        ),
      ),
    );
  }

  Future<void> _startNewConversation(BuildContext context, WidgetRef ref) async {
    final shop = await showModalBottomSheet<ShopSummary>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => const _ShopPickerSheet(),
    );
    if (shop == null || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      final conversationId = await startConversationWithShop(ref, shop.id);
      if (context.mounted) {
        context.push(Routes.messagePath(conversationId), extra: shop.name);
      }
    } on DioException {
      messenger.showSnackBar(
        const SnackBar(content: Text('Impossible d’ouvrir la conversation.')),
      );
    }
  }
}

/// Choix d'une boutique à qui écrire — recherche isolée de son propre appel
/// réseau plutôt que réutilisation de `shopSearchControllerProvider` : ce
/// dernier porte un filtre global partagé avec l'onglet Boutiques d'Explorer,
/// que cette feuille modale ne doit ni lire ni écraser.
class _ShopPickerSheet extends ConsumerStatefulWidget {
  const _ShopPickerSheet();

  @override
  ConsumerState<_ShopPickerSheet> createState() => _ShopPickerSheetState();
}

class _ShopPickerSheetState extends ConsumerState<_ShopPickerSheet> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<ShopSummary>? _results;
  bool _loading = false;
  // Distingue « liste par défaut » (populaires, avant toute saisie) de
  // « résultats de recherche » : sans repère, l'écran-titre ne saurait
  // jamais laquelle des deux il affiche.
  bool _isDefaultList = true;

  @override
  void initState() {
    super.initState();
    // Une feuille vide qui n'invite qu'à taper laisse croire qu'il faut
    // connaître le nom exact de la boutique : les populaires, affichées
    // d'emblée, montrent qu'on peut aussi simplement parcourir.
    _search('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => _search(value.trim()));
  }

  Future<void> _search(String query) async {
    setState(() {
      _loading = true;
      _isDefaultList = query.isEmpty;
    });
    try {
      final response = await ref.read(apiClientProvider).get<Map<String, dynamic>>(
        '/shops',
        queryParameters: <String, dynamic>{
          if (query.isEmpty) 'sort' : 'popular' else 'q': query,
          'limit': 20,
        },
      );
      if (!mounted) return;
      setState(() {
        _results = (response.data!['data'] as List<dynamic>)
            .map((json) => shopSummaryFromJson(json as Map<String, dynamic>))
            .toList();
      });
    } on DioException {
      if (mounted) setState(() => _results = const <ShopSummary>[]);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.75,
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AllGoTokens.space4,
                0,
                AllGoTokens.space4,
                AllGoTokens.space3,
              ),
              child: TextField(
                controller: _controller,
                autofocus: true,
                onChanged: _onQueryChanged,
                decoration: const InputDecoration(
                  hintText: 'Rechercher une boutique…',
                  prefixIcon: Icon(Icons.search),
                ),
              ),
            ),
            if (_loading && _results == null)
              // Squelette à la forme des lignes réelles (avatar + nom +
              // ville) plutôt qu'un cercle plein écran (§11.3) — cette
              // feuille modale affiche systématiquement les boutiques
              // populaires à l'ouverture, jamais une liste vide au repos.
              const Expanded(child: AvatarLineSkeletonList(itemCount: 5))
            else ...<Widget>[
              if (_loading) const LinearProgressIndicator(),
              if (_isDefaultList && (_results?.isNotEmpty ?? false))
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AllGoTokens.space4,
                    0,
                    AllGoTokens.space4,
                    AllGoTokens.space2,
                  ),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Boutiques populaires',
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                  ),
                ),
              Expanded(
                child: (_results?.isEmpty ?? true)
                    ? const Center(child: Text('Aucune boutique trouvée.'))
                    : ListView.builder(
                        itemCount: _results!.length,
                        itemBuilder: (context, i) {
                          final shop = _results![i];
                          return ListTile(
                            leading: ShopAvatar(
                                name: shop.name, logoUrl: shop.logo, categoryName: shop.categoryName),
                            title: Text(shop.name),
                            subtitle: shop.city == null ? null : Text(shop.city!),
                            onTap: () => Navigator.pop(context, shop),
                          );
                        },
                      ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ConversationList extends ConsumerWidget {
  const _ConversationList({required this.archived});

  final bool archived;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conversations = ref.watch(conversationsProvider(archived));
    final myUserId = currentUserId(ref);
    final dateFormat = DateFormat.Hm('fr');

    return AsyncView<List<Conversation>>(
      value: conversations,
      onRetry: () => ref.invalidate(conversationsProvider(archived)),
      isEmpty: (list) => list.isEmpty,
      // Chaque ligne réelle est un avatar + deux lignes de texte : le
      // squelette générique (blocs pleine largeur) ne le laissait pas deviner.
      skeleton: const AvatarLineSkeletonList(),
      emptyTitle: archived
          ? 'Aucune conversation archivée'
          : 'Aucune conversation pour l’instant',
      emptyMessage: archived
          ? 'Les conversations que vous archivez apparaîtront ici.'
          : 'Écrivez à une boutique depuis sa fiche pour démarrer une conversation.',
      data: (list) => RefreshIndicator(
        onRefresh: () async => ref.invalidate(conversationsProvider(archived)),
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(vertical: AllGoTokens.space2),
          itemCount: list.length,
          separatorBuilder: (_, __) =>
              const SizedBox(height: AllGoTokens.space1),
          itemBuilder: (context, i) {
            final conversation = list[i];
            final other =
                myUserId == null ? null : conversation.other(myUserId);
            final unread =
                myUserId == null ? 0 : conversation.unreadFor(myUserId);

            return Card(
              margin:
                  const EdgeInsets.symmetric(horizontal: AllGoTokens.space4),
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                leading: ShopAvatar(
                    name: other?.name ?? 'Boutique', logoUrl: other?.avatar),
                title: Text(
                  other?.name ?? 'Boutique',
                  style: TextStyle(
                      fontWeight:
                          unread > 0 ? FontWeight.w700 : FontWeight.w500),
                ),
                subtitle: conversation.lastMessageContent == null
                    ? null
                    : Text(
                        conversation.lastMessageContent!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight:
                              unread > 0 ? FontWeight.w600 : FontWeight.w400,
                          color: unread > 0
                              ? Theme.of(context).colorScheme.onSurface
                              : Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                trailing: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: <Widget>[
                    if (conversation.lastMessageAt != null)
                      Text(
                        dateFormat
                            .format(conversation.lastMessageAt!.toLocal()),
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                    const SizedBox(height: AllGoTokens.space1),
                    if (unread > 0)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color: AllGoTokens.brand,
                          borderRadius:
                              BorderRadius.circular(AllGoTokens.radiusPill),
                        ),
                        child: Text(
                          '$unread',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      )
                    else
                      PopupMenuButton<String>(
                        icon: const Icon(Icons.more_vert, size: 20),
                        padding: EdgeInsets.zero,
                        onSelected: (action) =>
                            _act(context, ref, conversation, action),
                        itemBuilder: (_) => <PopupMenuEntry<String>>[
                          if (!archived)
                            const PopupMenuItem(
                                value: 'archive', child: Text('Archiver')),
                          if (archived)
                            const PopupMenuItem(
                                value: 'unarchive', child: Text('Désarchiver')),
                        ],
                      ),
                  ],
                ),
                onTap: () async {
                  if (unread > 0 && myUserId != null) {
                    await markConversationRead(ref, conversation.id);
                    ref.invalidate(conversationsProvider(archived));
                  }
                  if (context.mounted) {
                    context.push(Routes.messagePath(conversation.id),
                        extra: other?.name);
                  }
                },
                onLongPress: () =>
                    _showActions(context, ref, conversation, unread, archived),
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _showActions(
    BuildContext context,
    WidgetRef ref,
    Conversation conversation,
    int unread,
    bool archived,
  ) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (unread > 0)
            ListTile(
              leading: const Icon(Icons.done_all),
              title: const Text('Marquer comme lu'),
              onTap: () => Navigator.pop(context, 'read'),
            ),
          ListTile(
            leading: Icon(
                archived ? Icons.unarchive_outlined : Icons.archive_outlined),
            title: Text(archived ? 'Désarchiver' : 'Archiver'),
            onTap: () =>
                Navigator.pop(context, archived ? 'unarchive' : 'archive'),
          ),
          const SizedBox(height: AllGoTokens.space4),
        ],
      ),
    );
    if (action != null && context.mounted)
      await _act(context, ref, conversation, action);
  }

  Future<void> _act(BuildContext context, WidgetRef ref,
      Conversation conversation, String action) async {
    if (action == 'read') {
      await markConversationRead(ref, conversation.id);
    } else if (action == 'archive') {
      await setConversationArchived(ref, conversation.id, archived: true);
    } else if (action == 'unarchive') {
      await setConversationArchived(ref, conversation.id, archived: false);
    }
    ref.invalidate(conversationsProvider(false));
    ref.invalidate(conversationsProvider(true));
  }
}
