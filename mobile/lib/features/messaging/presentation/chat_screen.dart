import 'dart:async';

import 'package:allgo/app/theme.dart';
import 'package:allgo/features/messaging/presentation/messaging_providers.dart';
import 'package:allgo/features/moderation/presentation/moderation_actions.dart';
import 'package:allgo/shared/widgets/shimmer.dart';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

/// Conversation client ↔ boutique — historique REST, réception en temps réel
/// via Socket.IO (§7.5). Texte seul : pas d'accusé de lecture, pas
/// d'indicateur de frappe, pas de pièce jointe (§ décisions de portée).
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({required this.conversationId, this.title, super.key});

  final String conversationId;
  final String? title;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    // Ouvrir la conversation vaut lecture : sans cet appel, le compteur de
    // non-lus ne retombe à zéro qu'en revenant à la liste et en le faisant
    // manuellement, ce qui n'a de sens pour personne.
    unawaited(markConversationRead(ref, widget.conversationId));
  }

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final myUserId = currentUserId(ref);
    final messages =
        ref.watch(conversationControllerProvider(widget.conversationId));
    // La conversation ouverte peut venir de l'onglet archivé comme de la
    // boîte principale : les deux listes sont cherchées, sans savoir a
    // priori de laquelle l'utilisateur vient.
    final conversations = <Conversation>[
      ...ref.watch(conversationsProvider(false)).valueOrNull ??
          const <Conversation>[],
      ...ref.watch(conversationsProvider(true)).valueOrNull ??
          const <Conversation>[],
    ];
    final conversation =
        conversations.firstWhereOrNull((c) => c.id == widget.conversationId);
    final otherUserId =
        myUserId == null ? null : conversation?.other(myUserId)?.userId;
    // Seul l'auteur du blocage peut le lever (le serveur ne retire QUE mon
    // identifiant de `blockedBy`) : « Débloquer » ne doit apparaître que si
    // c'est bien moi qui ai bloqué, pas si l'autre partie l'a fait.
    final blockedByMe =
        myUserId != null && (conversation?.blockedBy.contains(myUserId) ?? false);

    ref.listen(conversationControllerProvider(widget.conversationId), (_, __) {
      // Nouveau message (reçu ou envoyé) : on descend en bas de la liste.
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title ?? 'Conversation'),
        actions: <Widget>[
          PopupMenuButton<String>(
            onSelected: (value) => _onMenuSelected(context, value, otherUserId),
            itemBuilder: (context) => <PopupMenuEntry<String>>[
              blockedByMe
                  ? const PopupMenuItem<String>(
                      value: 'unblock_conversation',
                      child: Text('Débloquer la conversation'))
                  : const PopupMenuItem<String>(
                      value: 'block_conversation',
                      child: Text('Bloquer la conversation')),
              const PopupMenuItem<String>(
                  value: 'report', child: Text('Signaler la conversation')),
              if (otherUserId != null) ...<PopupMenuEntry<String>>[
                const PopupMenuDivider(),
                const PopupMenuItem<String>(
                    value: 'block_account', child: Text('Bloquer ce compte')),
                const PopupMenuItem<String>(
                    value: 'report_account', child: Text('Signaler ce compte')),
              ],
            ],
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          Expanded(
            child: messages.when(
              loading: () => const ChatBubbleSkeleton(),
              error: (_, __) =>
                  const Center(child: Text('Conversation indisponible.')),
              data: (list) => list.isEmpty
                  ? const Center(child: Text('Écrivez le premier message.'))
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.all(AllGoTokens.space4),
                      itemCount: list.length,
                      itemBuilder: (context, i) {
                        final message = list[i];
                        final isMine = message.senderId == myUserId;
                        return _MessageBubble(
                          message: message,
                          isMine: isMine,
                          onLongPress: () =>
                              _showMessageActions(context, message, isMine),
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
                      controller: _inputController,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration:
                          const InputDecoration(hintText: 'Écrire un message…'),
                    ),
                  ),
                  const SizedBox(width: AllGoTokens.space2),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _onMenuSelected(
      BuildContext context, String action, String? otherUserId) async {
    if (action == 'block_account' && otherUserId != null) {
      final confirmed =
          await confirmBlockUser(context, widget.title ?? 'ce compte');
      if (confirmed == true && context.mounted)
        await blockUserAccount(context, ref, otherUserId);
      return;
    }
    if (action == 'report_account' && otherUserId != null) {
      await reportViaDialog(
        context,
        ref,
        path: '/moderation/users/$otherUserId/report',
        dialogTitle: 'Signaler ce compte',
        successMessage: 'Compte signalé à la modération.',
      );
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    try {
      if (action == 'block_conversation') {
        await blockConversation(ref, widget.conversationId);
        ref.invalidate(conversationsProvider(false));
        ref.invalidate(conversationsProvider(true));
        messenger.showSnackBar(
            const SnackBar(content: Text('Conversation bloquée.')));
      } else if (action == 'unblock_conversation') {
        await unblockConversation(ref, widget.conversationId);
        ref.invalidate(conversationsProvider(false));
        ref.invalidate(conversationsProvider(true));
        messenger.showSnackBar(
            const SnackBar(content: Text('Conversation débloquée.')));
      } else if (action == 'report') {
        await reportConversation(ref, widget.conversationId);
        messenger.showSnackBar(
            const SnackBar(content: Text('Conversation signalée.')));
      }
    } on Exception {
      messenger.showSnackBar(
          const SnackBar(content: Text('Action impossible. Réessayez.')));
    }
  }

  Future<void> _send() async {
    final content = _inputController.text.trim();
    if (content.isEmpty || _sending) return;

    setState(() => _sending = true);
    try {
      await ref
          .read(conversationControllerProvider(widget.conversationId).notifier)
          .send(content);
      _inputController.clear();
    } on Exception {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Message non envoyé. Réessayez.')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _showMessageActions(
      BuildContext context, Message message, bool isMine) async {
    final scheme = Theme.of(context).colorScheme;
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(
          AllGoTokens.space6,
          0,
          AllGoTokens.space6,
          AllGoTokens.space6,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            // Modifier reste réservé à l'auteur — supprimer « pour moi »,
            // en revanche, s'applique aussi bien à mes messages qu'à ceux
            // reçus (§ suppression par participant).
            if (isMine) ...<Widget>[
              _MessageActionTile(
                icon: Icons.edit_outlined,
                label: 'Modifier',
                color: scheme.primary,
                onTap: () => Navigator.pop(context, 'edit'),
              ),
              const SizedBox(width: AllGoTokens.space6),
            ],
            _MessageActionTile(
              icon: Icons.delete_outline,
              label: 'Supprimer',
              color: scheme.error,
              onTap: () => Navigator.pop(context, 'delete'),
            ),
          ],
        ),
      ),
    );
    if (!context.mounted || action == null) return;
    if (action == 'edit') {
      await _editMessage(context, message);
    } else if (action == 'delete') {
      await _deleteMessage(context, message);
    }
  }

  Future<void> _editMessage(BuildContext context, Message message) async {
    final controller = TextEditingController(text: message.content);
    final newContent = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Modifier le message'),
        content: TextField(
          controller: controller,
          autofocus: true,
          minLines: 1,
          maxLines: 4,
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Enregistrer'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (newContent == null ||
        newContent.isEmpty ||
        newContent == message.content) return;
    if (!context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(conversationControllerProvider(widget.conversationId).notifier)
          .edit(message.id, newContent);
    } on Exception {
      messenger.showSnackBar(
          const SnackBar(content: Text('Modification impossible. Réessayez.')));
    }
  }

  Future<void> _deleteMessage(BuildContext context, Message message) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Supprimer ce message ?'),
        content: const Text(
            'Il ne sera supprimé que de votre côté — votre interlocuteur continuera de le voir.'),
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
    if (confirmed != true || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(conversationControllerProvider(widget.conversationId).notifier)
          .delete(message.id);
    } on Exception {
      messenger.showSnackBar(
          const SnackBar(content: Text('Suppression impossible. Réessayez.')));
    }
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble(
      {required this.message, required this.isMine, this.onLongPress});

  final Message message;
  final bool isMine;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final bubbleColor = isMine
        ? theme.colorScheme.primary
        : theme.colorScheme.surfaceContainerHighest;
    final textColor =
        isMine ? theme.colorScheme.onPrimary : theme.colorScheme.onSurface;

    final bubble = GestureDetector(
      onLongPress: onLongPress,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: AllGoTokens.space1),
        padding: const EdgeInsets.symmetric(
          horizontal: AllGoTokens.space3,
          vertical: AllGoTokens.space2,
        ),
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.68),
        decoration: BoxDecoration(
          color: bubbleColor,
          borderRadius: BorderRadius.circular(AllGoTokens.radiusSheet),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              message.content ?? '',
              style: theme.textTheme.bodyMedium?.copyWith(color: textColor),
            ),
            const SizedBox(height: 2),
            Text(
              message.isEdited
                  ? '${DateFormat.Hm('fr').format(message.createdAt.toLocal())} · modifié'
                  : DateFormat.Hm('fr').format(message.createdAt.toLocal()),
              style: theme.textTheme.labelSmall?.copyWith(
                color: textColor.withValues(alpha: 0.7),
              ),
            ),
          ],
        ),
      ),
    );

    // Le menu modifier/supprimer était jusqu'ici accessible uniquement par un
    // appui long, un geste que rien ne signale : ce bouton, toujours visible,
    // rend la fonctionnalité découvrable sans supprimer le raccourci. Le
    // fond circulaire le distingue d'une icône système générique perdue
    // dans la marge.
    final moreButton = onLongPress == null
        ? null
        : Tooltip(
            message: 'Options du message',
            child: Material(
              color: theme.colorScheme.surfaceContainerHighest,
              shape: const CircleBorder(),
              child: InkWell(
                onTap: onLongPress,
                customBorder: const CircleBorder(),
                child: Padding(
                  padding: const EdgeInsets.all(6),
                  child: Icon(
                    Icons.more_vert,
                    size: 16,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          );

    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: isMine
            ? <Widget>[if (moreButton != null) moreButton, bubble]
            : <Widget>[bubble, if (moreButton != null) moreButton],
      ),
    );
  }
}

/// Action du menu message — icône badgée sur fond teinté, libellé dessous
/// (référence : menu contextuel des messageries grand public), plutôt qu'une
/// liste de `ListTile` trop proche des menus système génériques.
class _MessageActionTile extends StatelessWidget {
  const _MessageActionTile({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AllGoTokens.space2,
          vertical: AllGoTokens.space2,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: Icon(icon, color: color, size: 24),
            ),
            const SizedBox(height: AllGoTokens.space2),
            Text(
              label,
              textAlign: TextAlign.center,
              style: Theme.of(context)
                  .textTheme
                  .labelMedium
                  ?.copyWith(color: Theme.of(context).colorScheme.onSurface),
            ),
          ],
        ),
      ),
    );
  }
}
