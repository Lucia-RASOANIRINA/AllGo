import 'package:allgo/app/theme.dart';
import 'package:allgo/features/messaging/presentation/messaging_providers.dart';
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
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final myUserId = currentUserId(ref);
    final messages = ref.watch(conversationControllerProvider(widget.conversationId));

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
            onSelected: (value) => _onMenuSelected(context, value),
            itemBuilder: (context) => const <PopupMenuEntry<String>>[
              PopupMenuItem<String>(value: 'block', child: Text('Bloquer')),
              PopupMenuItem<String>(value: 'report', child: Text('Signaler')),
            ],
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          Expanded(
            child: messages.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, __) => const Center(child: Text('Conversation indisponible.')),
              data: (list) => list.isEmpty
                  ? const Center(child: Text('Écrivez le premier message.'))
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.all(AllGoTokens.space4),
                      itemCount: list.length,
                      itemBuilder: (context, i) {
                        final message = list[i];
                        return _MessageBubble(
                          message: message,
                          isMine: message.senderId == myUserId,
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
                      decoration: const InputDecoration(hintText: 'Écrire un message…'),
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

  Future<void> _onMenuSelected(BuildContext context, String action) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (action == 'block') {
        await blockConversation(ref, widget.conversationId);
        messenger.showSnackBar(const SnackBar(content: Text('Conversation bloquée.')));
      } else if (action == 'report') {
        await reportConversation(ref, widget.conversationId);
        messenger.showSnackBar(const SnackBar(content: Text('Conversation signalée.')));
      }
    } on Exception {
      messenger.showSnackBar(const SnackBar(content: Text('Action impossible. Réessayez.')));
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
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message, required this.isMine});

  final Message message;
  final bool isMine;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: AllGoTokens.space1),
        padding: const EdgeInsets.symmetric(
          horizontal: AllGoTokens.space3,
          vertical: AllGoTokens.space2,
        ),
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.75),
        decoration: BoxDecoration(
          color: isMine ? theme.colorScheme.primary : theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(AllGoTokens.radiusSheet),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text(
              message.content ?? '',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: isMine ? theme.colorScheme.onPrimary : theme.colorScheme.onSurface,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              DateFormat.Hm('fr').format(message.createdAt.toLocal()),
              style: theme.textTheme.labelSmall?.copyWith(
                color: (isMine ? theme.colorScheme.onPrimary : theme.colorScheme.onSurface)
                    .withValues(alpha: 0.7),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
